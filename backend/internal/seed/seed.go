// Package seed loads the demo data of SPEC §6 (`server seed`).
//
// Everything is created through the service layer, exactly as API requests would create
// it, so the data obeys every domain rule and comes with a genuine activity history
// (status changes, sprint moves, comments, links, ...). The seed plays a four-week
// timeline: each step runs now and is then backdated to its point on the timeline (see
// seeder.step). History, sprint dates, the completed sprint and the Kanban board's 14-day
// window therefore look like those of a real project.
package seed

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/service"
)

// Demo account (SPEC §6). All seeded users share the password.
const (
	DemoEmail    = "demo@geneboard.dev"
	DemoPassword = "password123"
)

// Run seeds the demo data unless the demo user already exists (so running it twice is
// harmless). The service must be wired to pool's database, already migrated.
func Run(ctx context.Context, svc *service.Service, pool *pgxpool.Pool, logger *slog.Logger) error {
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)`, DemoEmail).Scan(&exists); err != nil {
		return fmt.Errorf("seed: check for the demo user: %w", err)
	}
	if exists {
		logger.Info("demo data already present, nothing to do", "user", DemoEmail)
		return nil
	}
	sd := newSeeder(ctx, svc, pool)
	if err := sd.run(); err != nil {
		return fmt.Errorf("seed: %w (the database may now hold partial demo data; reset it before seeding again)", err)
	}
	logger.Info("seeded demo data", "projects", "GB (scrum), OPS (kanban)",
		"issues", len(sd.issues), "login", DemoEmail, "password", DemoPassword)
	return nil
}

// RunIfEmpty seeds the demo data only into a database without users (`server seed
// --if-empty`, which `make up` runs on every start): a new database gets the demo data, and
// one in real use is left alone — Run would add the demo accounts to it, and fail halfway
// if one of its projects already uses the key GB or OPS.
func RunIfEmpty(ctx context.Context, svc *service.Service, pool *pgxpool.Pool, logger *slog.Logger) error {
	var hasUsers bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users)`).Scan(&hasUsers); err != nil {
		return fmt.Errorf("seed: check for users: %w", err)
	}
	if hasUsers {
		logger.Info("the database already has users; not loading the demo data")
		return nil
	}
	return Run(ctx, svc, pool, logger)
}

// seeder carries the seed's state. Actions record the first error in err and become
// no-ops afterwards, which keeps the timeline in demo.go free of error plumbing.
type seeder struct {
	ctx  context.Context
	svc  *service.Service
	pool *pgxpool.Pool
	err  error

	now   time.Time // when the seed started; the timeline ends shortly before it
	today time.Time // local midnight of now's date (dates are what users see in their UI)
	last  time.Time // time of the previous timeline step

	users    map[string]int64            // handle -> user id
	emails   map[string]string           // handle -> e-mail
	statuses map[string]map[string]int64 // project key -> status name -> id
	labels   map[string]map[string]int64 // project key -> label name -> id
	issues   map[string]dto.IssueDetail  // handle -> issue as created
	sprints  map[string]dto.Sprint       // handle -> sprint
}

func newSeeder(ctx context.Context, svc *service.Service, pool *pgxpool.Pool) *seeder {
	now := time.Now()
	return &seeder{
		ctx:      ctx,
		svc:      svc,
		pool:     pool,
		now:      now,
		today:    time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()),
		users:    map[string]int64{},
		emails:   map[string]string{},
		statuses: map[string]map[string]int64{},
		labels:   map[string]map[string]int64{},
		issues:   map[string]dto.IssueDetail{},
		sprints:  map[string]dto.Sprint{},
	}
}

func (sd *seeder) fail(err error) {
	if sd.err == nil {
		sd.err = err
	}
}

// --- timeline ---

// at is hh:mm local time, daysAgo days before today. Steps on earlier days must not be
// later than 18:00, so that they always precede today's steps (see hoursAgo).
func (sd *seeder) at(daysAgo, hour, minute int) time.Time {
	return sd.today.AddDate(0, 0, -daysAgo).Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute)
}

// hoursAgo is a moment earlier today, at most 5 hours before the seed started (so after
// any at(1, <=18, _) step).
func (sd *seeder) hoursAgo(h float64) time.Time {
	return sd.now.Add(-time.Duration(h * float64(time.Hour)))
}

// date returns the calendar date daysFromToday days from today (negative = past).
func (sd *seeder) date(daysFromToday int) *dto.Date {
	d := dto.NewDate(sd.today.AddDate(0, 0, daysFromToday))
	return &d
}

// backdateSlack widens the "written during this step" window for clock skew between the
// database and this process (both stamp rows).
const backdateSlack = 2 * time.Second

// backdatedColumns lists every timestamp column the service layer writes.
var backdatedColumns = []struct{ table, column string }{
	{"users", "created_at"}, {"users", "updated_at"},
	{"projects", "created_at"}, {"projects", "updated_at"},
	{"project_members", "created_at"},
	{"statuses", "created_at"},
	{"labels", "created_at"},
	{"sprints", "created_at"}, {"sprints", "updated_at"}, {"sprints", "completed_at"},
	{"issues", "created_at"}, {"issues", "updated_at"}, {"issues", "resolved_at"},
	{"issue_links", "created_at"},
	{"comments", "created_at"}, {"comments", "updated_at"},
	{"activities", "created_at"},
}

// step runs fn (a few service calls) and then moves every timestamp it wrote to when.
// Steps must be chronological and in the past: rows written by earlier steps then carry
// timestamps well before this step started, so "written during this step" is simply
// "stamped at or after the step's start".
func (sd *seeder) step(when time.Time, fn func()) {
	if sd.err != nil {
		return
	}
	if !when.After(sd.last) || !when.Before(sd.now) {
		sd.fail(fmt.Errorf("timeline step at %s is out of order", when.Format(time.RFC3339)))
		return
	}
	sd.last = when

	var since time.Time
	if err := sd.pool.QueryRow(sd.ctx, "SELECT now()").Scan(&since); err != nil {
		sd.fail(fmt.Errorf("read database time: %w", err))
		return
	}
	if local := time.Now(); local.Before(since) {
		since = local
	}
	since = since.Add(-backdateSlack)

	fn()
	if sd.err != nil {
		return
	}
	batch := &pgx.Batch{}
	for _, c := range backdatedColumns {
		table, column := pgx.Identifier{c.table}.Sanitize(), pgx.Identifier{c.column}.Sanitize()
		batch.Queue(fmt.Sprintf("UPDATE %s SET %s = $2 WHERE %s >= $1", table, column, column), since, when)
	}
	if err := sd.pool.SendBatch(sd.ctx, batch).Close(); err != nil {
		sd.fail(fmt.Errorf("backdate step to %s: %w", when.Format(time.RFC3339), err))
	}
}

// --- lookups ---

func (sd *seeder) user(handle string) int64 {
	id, ok := sd.users[handle]
	if !ok {
		sd.fail(fmt.Errorf("unknown user %q", handle))
	}
	return id
}

func (sd *seeder) issue(ref string) dto.IssueDetail {
	is, ok := sd.issues[ref]
	if !ok {
		sd.fail(fmt.Errorf("unknown issue %q", ref))
	}
	return is
}

// key returns the issue key of a handle (for comments that mention other issues).
func (sd *seeder) key(ref string) string { return sd.issue(ref).Key }

func (sd *seeder) sprint(handle string) dto.Sprint {
	sp, ok := sd.sprints[handle]
	if !ok {
		sd.fail(fmt.Errorf("unknown sprint %q", handle))
	}
	return sp
}

func (sd *seeder) status(projectKey, name string) int64 {
	id, ok := sd.statuses[projectKey][name]
	if !ok {
		sd.fail(fmt.Errorf("unknown status %q in %s", name, projectKey))
	}
	return id
}

// md turns a Markdown literal of demo.go into the stored text: Go raw strings cannot
// contain backticks, so the literals use "ˋ" (U+02CB) in their place.
func md(s string) string { return strings.ReplaceAll(strings.TrimSpace(s), "ˋ", "`") }

// --- actions (each is a no-op once an error has been recorded) ---

func (sd *seeder) register(handle, name, email string) {
	if sd.err != nil {
		return
	}
	res, err := sd.svc.Register(sd.ctx, service.RegisterInput{Email: email, Name: name, Password: DemoPassword})
	if err != nil {
		sd.fail(fmt.Errorf("register %s: %w", email, err))
		return
	}
	sd.users[handle] = res.User.ID
	sd.emails[handle] = email
}

func (sd *seeder) createProject(actor, key, name, projectType, description string) {
	if sd.err != nil {
		return
	}
	uid := sd.user(actor)
	if _, err := sd.svc.CreateProject(sd.ctx, uid, service.CreateProjectInput{
		Key: key, Name: name, Type: projectType, Description: md(description),
	}); err != nil {
		sd.fail(fmt.Errorf("create project %s: %w", key, err))
		return
	}
	statuses, err := sd.svc.ListStatuses(sd.ctx, uid, key)
	if err != nil {
		sd.fail(fmt.Errorf("list statuses of %s: %w", key, err))
		return
	}
	sd.statuses[key] = map[string]int64{}
	for _, st := range statuses {
		sd.statuses[key][st.Name] = st.ID
	}
	sd.labels[key] = map[string]int64{}
}

func (sd *seeder) addMember(actor, projectKey, handle, role string) {
	if sd.err != nil {
		return
	}
	in := service.AddMemberInput{Email: sd.emails[handle], Role: role}
	if _, err := sd.svc.AddMember(sd.ctx, sd.user(actor), projectKey, in); err != nil {
		sd.fail(fmt.Errorf("add %s to %s: %w", handle, projectKey, err))
	}
}

// label is a label name and colour.
type label struct{ name, color string }

func (sd *seeder) createLabels(actor, projectKey string, labels ...label) {
	for _, l := range labels {
		if sd.err != nil {
			return
		}
		created, err := sd.svc.CreateLabel(sd.ctx, sd.user(actor), projectKey, service.CreateLabelInput{Name: l.name, Color: l.color})
		if err != nil {
			sd.fail(fmt.Errorf("create label %s in %s: %w", l.name, projectKey, err))
			return
		}
		sd.labels[projectKey][l.name] = created.ID
	}
}

func (sd *seeder) setWipLimit(actor, projectKey, statusName string, limit int) {
	if sd.err != nil {
		return
	}
	if _, err := sd.svc.UpdateStatus(sd.ctx, sd.user(actor), projectKey, sd.status(projectKey, statusName),
		service.UpdateStatusInput{WipLimit: httpx.Some(limit)}); err != nil {
		sd.fail(fmt.Errorf("set WIP limit of %s/%s: %w", projectKey, statusName, err))
	}
}

// issueSpec describes an issue to create.
type issueSpec struct {
	ref      string // handle used by later steps
	typ      string
	summary  string
	desc     string // Markdown (see md)
	priority string // "" = medium
	points   float64
	assignee string // user handle; "" = unassigned (the creator is the reporter)
	labels   []string
	parent   string // handle of the parent issue
	sprint   string // handle of the sprint; subtasks inherit their parent's
	status   string // status name; "" = first column
	dueIn    *int   // due date, in days from today
}

func days(n int) *int { return &n }

func (sd *seeder) create(actor, projectKey string, specs ...issueSpec) {
	for _, sp := range specs {
		if sd.err != nil {
			return
		}
		in := service.CreateIssueInput{Type: sp.typ, Summary: sp.summary, Description: md(sp.desc), Priority: sp.priority}
		if sp.points > 0 {
			in.StoryPoints = &sp.points
		}
		if sp.assignee != "" {
			in.AssigneeID = ptr(sd.user(sp.assignee))
		}
		for _, name := range sp.labels {
			id, ok := sd.labels[projectKey][name]
			if !ok {
				sd.fail(fmt.Errorf("unknown label %q in %s", name, projectKey))
				return
			}
			in.LabelIDs = append(in.LabelIDs, id)
		}
		if sp.parent != "" {
			in.ParentID = ptr(sd.issue(sp.parent).ID)
		}
		if sp.sprint != "" {
			in.SprintID = httpx.Some(sd.sprint(sp.sprint).ID)
		}
		if sp.status != "" {
			in.StatusID = ptr(sd.status(projectKey, sp.status))
		}
		if sp.dueIn != nil {
			in.DueDate = sd.date(*sp.dueIn)
		}
		if sd.err != nil {
			return
		}
		created, err := sd.svc.CreateIssue(sd.ctx, sd.user(actor), projectKey, in)
		if err != nil {
			sd.fail(fmt.Errorf("create %s %q: %w", sp.typ, sp.summary, err))
			return
		}
		sd.issues[sp.ref] = created
	}
}

// move changes an issue's status the way a board drag does.
func (sd *seeder) move(actor, ref, statusName string) {
	if sd.err != nil {
		return
	}
	is := sd.issue(ref)
	in := service.MoveIssueInput{StatusID: httpx.Some(sd.status(is.ProjectKey, statusName))}
	if _, err := sd.svc.MoveIssue(sd.ctx, sd.user(actor), is.Key, in); err != nil {
		sd.fail(fmt.Errorf("move %s to %s: %w", is.Key, statusName, err))
	}
}

// moveToSprint drags issues into a sprint on the backlog page ("" = the backlog).
func (sd *seeder) moveToSprint(actor, sprintHandle string, refs ...string) {
	for _, ref := range refs {
		if sd.err != nil {
			return
		}
		in := service.MoveIssueInput{SprintID: httpx.Null[int64]()}
		if sprintHandle != "" {
			in.SprintID = httpx.Some(sd.sprint(sprintHandle).ID)
		}
		is := sd.issue(ref)
		if _, err := sd.svc.MoveIssue(sd.ctx, sd.user(actor), is.Key, in); err != nil {
			sd.fail(fmt.Errorf("move %s to sprint %q: %w", is.Key, sprintHandle, err))
		}
	}
}

// rankAbove re-ranks ref directly above other (drag within a list).
func (sd *seeder) rankAbove(actor, ref, other string) {
	if sd.err != nil {
		return
	}
	is := sd.issue(ref)
	in := service.MoveIssueInput{NextIssueID: httpx.Some(sd.issue(other).ID)}
	if _, err := sd.svc.MoveIssue(sd.ctx, sd.user(actor), is.Key, in); err != nil {
		sd.fail(fmt.Errorf("rank %s above %s: %w", is.Key, other, err))
	}
}

func (sd *seeder) patch(actor, ref string, in service.UpdateIssueInput) {
	if sd.err != nil {
		return
	}
	is := sd.issue(ref)
	if _, err := sd.svc.UpdateIssue(sd.ctx, sd.user(actor), is.Key, in); err != nil {
		sd.fail(fmt.Errorf("update %s: %w", is.Key, err))
	}
}

func (sd *seeder) comment(actor, ref, body string) {
	if sd.err != nil {
		return
	}
	is := sd.issue(ref)
	if _, err := sd.svc.CreateComment(sd.ctx, sd.user(actor), is.Key, service.CommentInput{Body: md(body)}); err != nil {
		sd.fail(fmt.Errorf("comment on %s: %w", is.Key, err))
	}
}

func (sd *seeder) link(actor, ref, linkType, targetRef string) {
	if sd.err != nil {
		return
	}
	src, dst := sd.issue(ref), sd.issue(targetRef)
	if _, err := sd.svc.CreateLink(sd.ctx, sd.user(actor), src.Key, service.CreateLinkInput{Type: linkType, TargetKey: dst.Key}); err != nil {
		sd.fail(fmt.Errorf("link %s %s %s: %w", src.Key, linkType, dst.Key, err))
	}
}

func (sd *seeder) createSprint(actor, projectKey, handle, goal string) {
	if sd.err != nil {
		return
	}
	sp, err := sd.svc.CreateSprint(sd.ctx, sd.user(actor), projectKey, service.CreateSprintInput{Goal: goal})
	if err != nil {
		sd.fail(fmt.Errorf("create sprint %s in %s: %w", handle, projectKey, err))
		return
	}
	sd.sprints[handle] = sp
}

// startSprint starts a sprint running from startIn to endIn days from today.
func (sd *seeder) startSprint(actor, handle string, startIn, endIn int, goal string) {
	if sd.err != nil {
		return
	}
	sp, err := sd.svc.StartSprint(sd.ctx, sd.user(actor), sd.sprint(handle).ID, service.StartSprintInput{
		StartDate: sd.date(startIn), EndDate: sd.date(endIn), Goal: httpx.Some(goal),
	})
	if err != nil {
		sd.fail(fmt.Errorf("start sprint %s: %w", handle, err))
		return
	}
	sd.sprints[handle] = sp
}

// completeSprintIntoNew completes a sprint, moving its open issues into a new sprint registered
// under newHandle.
func (sd *seeder) completeSprintIntoNew(actor, handle, newHandle string) {
	if sd.err != nil {
		return
	}
	res, err := sd.svc.CompleteSprint(sd.ctx, sd.user(actor), sd.sprint(handle).ID, service.CompleteSprintInput{Target: service.CompleteTargetNew})
	if err != nil {
		sd.fail(fmt.Errorf("complete sprint %s: %w", handle, err))
		return
	}
	sd.sprints[handle] = res.Sprint
	sd.sprints[newHandle] = *res.TargetSprint
}

func ptr[T any](v T) *T { return &v }
