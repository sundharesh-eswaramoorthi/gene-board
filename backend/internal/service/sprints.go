package service

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"strings"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/realtime"
)

// Sprint lifecycle (SPEC §2 Sprints): planned -> active -> completed.
//
// Locking: every lifecycle change takes the project row lock first, then the sprint row
// (lockSprint), then the sprint's issues (ListSprintStandardIssues). Every write of issue
// rows — create, update, move, delete, and the status / member changes that rewrite issues
// — also takes the project lock before locking any issue, so issue writes are serialised
// with lifecycle changes and always lock in the same order (project, issue, then the rows
// it refers to: parent, status, sprint). Issue writes that put an issue into a sprint
// share-lock the sprint row (resolveSprint). A sprint therefore cannot be completed or
// deleted while an issue is being added to it or re-statused, an issue moved away is not
// dragged back, and the orders cannot deadlock (row locks are FOR NO KEY UPDATE, so
// foreign-key checks of concurrent inserts are never blocked). ListSprintStandardIssues
// also re-reads a concurrently re-statused issue correctly (see its query comment), in
// case a writer ever changes issues without the project lock.

// CreateSprintInput is the body of POST /projects/{key}/sprints. An empty name gets the
// default "<KEY> Sprint <n>".
type CreateSprintInput struct {
	Name      string    `json:"name"`
	Goal      string    `json:"goal"`
	StartDate *dto.Date `json:"startDate"`
	EndDate   *dto.Date `json:"endDate"`
}

// UpdateSprintInput is the body of PATCH /sprints/{id} (PATCH semantics; null clears the
// goal and the dates).
type UpdateSprintInput struct {
	Name      httpx.Optional[string]   `json:"name,omitzero"`
	Goal      httpx.Optional[string]   `json:"goal,omitzero"`
	StartDate httpx.Optional[dto.Date] `json:"startDate,omitzero"`
	EndDate   httpx.Optional[dto.Date] `json:"endDate,omitzero"`
}

// StartSprintInput is the body of POST /sprints/{id}/start. startDate / endDate fall back
// to the dates already stored on the sprint (as in Jira); the started sprint must have
// both. name / goal optionally rename the sprint or set its goal.
type StartSprintInput struct {
	StartDate *dto.Date              `json:"startDate"`
	EndDate   *dto.Date              `json:"endDate"`
	Name      httpx.Optional[string] `json:"name,omitzero"`
	Goal      httpx.Optional[string] `json:"goal,omitzero"`
}

// Targets for the open issues of a sprint being completed.
const (
	CompleteTargetBacklog = "backlog" // move open issues to the backlog
	CompleteTargetSprint  = "sprint"  // move them to an existing planned sprint (SprintID)
	CompleteTargetNew     = "new"     // move them to a new planned sprint created on the fly
)

var completeTargets = []string{CompleteTargetBacklog, CompleteTargetSprint, CompleteTargetNew}

// CompleteSprintInput is the body of POST /sprints/{id}/complete. An empty target means
// the backlog.
type CompleteSprintInput struct {
	Target   string `json:"target"`
	SprintID *int64 `json:"sprintId"`
}

var (
	errSprintNotFound  = httpx.NotFound("Sprint not found")
	errKanbanSprints   = invalid("Kanban projects do not use sprints")
	errSprintCompleted = httpx.Conflict("Completed sprints are read-only")
)

// sprintAccess is a sprint, its project and the caller's role in that project.
type sprintAccess struct {
	sprint  db.Sprint
	project db.Project
	role    Role
}

// sprintByID loads a sprint of a project the user belongs to and checks the minimum role
// (404 for unknown sprints and non-members, 403 for insufficient roles).
func (s *Service) sprintByID(ctx context.Context, q *db.Queries, userID, sprintID int64, min Role) (sprintAccess, error) {
	sp, err := q.GetSprint(ctx, sprintID)
	if isNoRows(err) {
		return sprintAccess{}, errSprintNotFound
	}
	if err != nil {
		return sprintAccess{}, fmt.Errorf("load sprint %d: %w", sprintID, err)
	}
	acc, err := s.projectByID(ctx, q, userID, sp.ProjectID, min)
	if httpx.IsCode(err, httpx.CodeNotFound) {
		return sprintAccess{}, errSprintNotFound
	}
	if err != nil {
		return sprintAccess{}, err
	}
	return sprintAccess{sprint: sp, project: acc.project, role: acc.role}, nil
}

// lockSprint resolves a sprint for a lifecycle change (member role): it locks the project
// row, then re-reads the sprint with a row lock held for the rest of the transaction.
func (s *Service) lockSprint(ctx context.Context, t *txn, userID, sprintID int64) (sprintAccess, error) {
	acc, err := s.sprintByID(ctx, t.q, userID, sprintID, RoleMember)
	if err != nil {
		return sprintAccess{}, err
	}
	if err := t.q.LockProject(ctx, acc.project.ID); err != nil {
		return sprintAccess{}, fmt.Errorf("lock project: %w", err)
	}
	sp, err := t.q.LockSprint(ctx, sprintID)
	if isNoRows(err) { // deleted concurrently
		return sprintAccess{}, errSprintNotFound
	}
	if err != nil {
		return sprintAccess{}, fmt.Errorf("lock sprint: %w", err)
	}
	acc.sprint = sp
	return acc, nil
}

// ParseSprintStates parses the optional state filter of GET /projects/{key}/sprints
// (comma-separated and/or repeated; empty means every state).
func ParseSprintStates(v url.Values) ([]string, error) {
	states := []string{}
	for _, st := range listParam(v, "state") {
		st = strings.ToLower(st)
		if !slices.Contains(sprintStates, st) {
			return nil, httpx.BadRequest("Invalid value for query parameter %q", "state")
		}
		if !slices.Contains(states, st) {
			states = append(states, st)
		}
	}
	return states, nil
}

// ListSprints returns a project's sprints: the active one first, then planned sprints by
// id, then completed sprints, most recently completed first. states filters by state
// (empty = all).
func (s *Service) ListSprints(ctx context.Context, userID int64, projectKey string, states []string) ([]dto.Sprint, error) {
	acc, err := s.projectByKey(ctx, s.q, userID, projectKey, RoleViewer)
	if err != nil {
		return nil, err
	}
	if states == nil {
		states = []string{}
	}
	rows, err := s.q.ListProjectSprints(ctx, db.ListProjectSprintsParams{ProjectID: acc.project.ID, States: states})
	if err != nil {
		return nil, fmt.Errorf("list sprints: %w", err)
	}
	return sprintViews(ctx, s.q, rows)
}

// GetSprint returns one sprint with its statistics.
func (s *Service) GetSprint(ctx context.Context, userID, sprintID int64) (dto.Sprint, error) {
	acc, err := s.sprintByID(ctx, s.q, userID, sprintID, RoleViewer)
	if err != nil {
		return dto.Sprint{}, err
	}
	return sprintView(ctx, s.q, acc.sprint)
}

// CreateSprint creates a planned sprint (member role; Scrum projects only).
func (s *Service) CreateSprint(ctx context.Context, userID int64, projectKey string, in CreateSprintInput) (dto.Sprint, error) {
	name := strings.TrimSpace(in.Name)
	goal := strings.TrimSpace(in.Goal)
	var fe httpx.FieldErrors
	checkLength(&fe, "name", name, 0, maxSprintName)
	checkLength(&fe, "goal", goal, 0, maxSprintGoal)
	checkSprintDates(&fe, in.StartDate, in.EndDate)
	if err := fe.Err(); err != nil {
		return dto.Sprint{}, err
	}

	var out dto.Sprint
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, projectKey, RoleMember)
		if err != nil {
			return err
		}
		if err := t.q.LockProject(ctx, acc.project.ID); err != nil { // serialises default naming
			return fmt.Errorf("lock project: %w", err)
		}
		sp, err := t.createSprint(ctx, userID, acc.project, name, goal, in.StartDate, in.EndDate)
		if err != nil {
			return err
		}
		out, err = sprintView(ctx, t.q, sp)
		return err
	})
	return out, err
}

// createSprint inserts a planned sprint into p, whose row the caller has locked. An empty
// name gets the default "<KEY> Sprint <n>". Logs sprint.created and queues a realtime
// event.
func (t *txn) createSprint(ctx context.Context, actorID int64, p db.Project, name, goal string, start, end *dto.Date) (db.Sprint, error) {
	if p.Type == dto.ProjectTypeKanban {
		return db.Sprint{}, errKanbanSprints
	}
	if name == "" {
		var err error
		if name, err = defaultSprintName(ctx, t.q, p); err != nil {
			return db.Sprint{}, err
		}
	}
	sp, err := t.q.CreateSprint(ctx, db.CreateSprintParams{
		ProjectID: p.ID, Name: name, Goal: goal, StartDate: start.TimePtr(), EndDate: end.TimePtr(),
	})
	if err != nil {
		return db.Sprint{}, fmt.Errorf("create sprint: %w", err)
	}
	if err := t.logActivity(ctx, actorID, projectEntry(p.ID, ActionSprintCreated, sp.Name)); err != nil {
		return db.Sprint{}, err
	}
	t.publish(p.ID, realtime.SprintChanged, p.Key, "", actorID)
	return sp, nil
}

// defaultSprintName returns "<KEY> Sprint <n>" where n is one more than the number of
// sprints ever created in the project, skipping names that are already in use.
func defaultSprintName(ctx context.Context, q *db.Queries, p db.Project) (string, error) {
	created, err := q.CountSprintsCreated(ctx, p.ID)
	if err != nil {
		return "", fmt.Errorf("count sprints: %w", err)
	}
	names, err := q.ListSprintNames(ctx, p.ID)
	if err != nil {
		return "", fmt.Errorf("list sprint names: %w", err)
	}
	taken := make(map[string]bool, len(names))
	for _, n := range names {
		taken[strings.ToLower(n)] = true
	}
	for n := created + 1; ; n++ {
		if name := fmt.Sprintf("%s Sprint %d", p.Key, n); !taken[strings.ToLower(name)] {
			return name, nil
		}
	}
}

// UpdateSprint edits a planned or active sprint's name, goal and dates (member role).
// Completed sprints are read-only (409); an active sprint must keep both dates.
func (s *Service) UpdateSprint(ctx context.Context, userID, sprintID int64, in UpdateSprintInput) (dto.Sprint, error) {
	var out dto.Sprint
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.lockSprint(ctx, t, userID, sprintID)
		if err != nil {
			return err
		}
		cur := acc.sprint
		if cur.State == dto.SprintCompleted {
			return errSprintCompleted
		}
		curStart, curEnd := dto.DatePtr(cur.StartDate), dto.DatePtr(cur.EndDate)
		name, goal, start, end := cur.Name, cur.Goal, curStart, curEnd

		var fe httpx.FieldErrors
		if in.Name.Set {
			if in.Name.Null {
				fe.Add("name", "must not be null")
			} else {
				name = strings.TrimSpace(in.Name.Value)
				checkLength(&fe, "name", name, 1, maxSprintName)
			}
		}
		if in.Goal.Set {
			goal = strings.TrimSpace(in.Goal.Value) // null clears
			checkLength(&fe, "goal", goal, 0, maxSprintGoal)
		}
		if in.StartDate.Set {
			start = in.StartDate.Ptr()
		}
		if in.EndDate.Set {
			end = in.EndDate.Ptr()
		}
		if cur.State == dto.SprintActive {
			fe.Check(start != nil, "startDate", "is required for an active sprint")
			fe.Check(end != nil, "endDate", "is required for an active sprint")
		}
		checkSprintDates(&fe, start, end)
		if err := fe.Err(); err != nil {
			return err
		}

		if name == cur.Name && goal == cur.Goal && equalPtr(start, curStart) && equalPtr(end, curEnd) {
			out, err = sprintView(ctx, t.q, cur)
			return err
		}
		updated, err := t.q.UpdateSprint(ctx, db.UpdateSprintParams{
			ID: cur.ID, Name: name, Goal: goal, StartDate: start.TimePtr(), EndDate: end.TimePtr(),
		})
		if err != nil {
			return fmt.Errorf("update sprint: %w", err)
		}
		t.publish(acc.project.ID, realtime.SprintChanged, acc.project.Key, "", userID)
		out, err = sprintView(ctx, t.q, updated)
		return err
	})
	return out, err
}

// DeleteSprint deletes a planned sprint (member role); its issues (and their subtasks) go
// to the backlog, each logged as a sprint change. Active and completed sprints cannot be
// deleted (409).
func (s *Service) DeleteSprint(ctx context.Context, userID, sprintID int64) error {
	return s.inTx(ctx, func(t *txn) error {
		acc, err := s.lockSprint(ctx, t, userID, sprintID)
		if err != nil {
			return err
		}
		sp := acc.sprint
		if sp.State != dto.SprintPlanned {
			return httpx.Conflict("Only planned sprints can be deleted")
		}
		issues, err := t.q.ListSprintStandardIssues(ctx, sp.ID)
		if err != nil {
			return fmt.Errorf("list sprint issues: %w", err)
		}
		ids := make([]int64, len(issues))
		for i, is := range issues {
			ids[i] = is.ID
		}
		if err := t.moveIssuesToSprint(ctx, userID, ids, nil); err != nil {
			return err
		}
		if err := t.q.DeleteSprint(ctx, sp.ID); err != nil {
			return fmt.Errorf("delete sprint: %w", err)
		}
		t.publish(acc.project.ID, realtime.SprintChanged, acc.project.Key, "", userID)
		return nil
	})
}

// StartSprint starts a planned sprint (member role; Scrum projects only). The sprint needs
// a start and an end date (from the body or already stored) with end >= start, and only
// one sprint per project can be active (409).
func (s *Service) StartSprint(ctx context.Context, userID, sprintID int64, in StartSprintInput) (dto.Sprint, error) {
	var out dto.Sprint
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.lockSprint(ctx, t, userID, sprintID)
		if err != nil {
			return err
		}
		cur, p := acc.sprint, acc.project
		if p.Type == dto.ProjectTypeKanban {
			return errKanbanSprints
		}
		switch cur.State {
		case dto.SprintActive:
			return httpx.Conflict("This sprint has already been started")
		case dto.SprintCompleted:
			return httpx.Conflict("Completed sprints cannot be started again")
		}

		name, goal := cur.Name, cur.Goal
		start, end := in.StartDate, in.EndDate
		if start == nil {
			start = dto.DatePtr(cur.StartDate)
		}
		if end == nil {
			end = dto.DatePtr(cur.EndDate)
		}
		var fe httpx.FieldErrors
		if in.Name.Set {
			if in.Name.Null {
				fe.Add("name", "must not be null")
			} else {
				name = strings.TrimSpace(in.Name.Value)
				checkLength(&fe, "name", name, 1, maxSprintName)
			}
		}
		if in.Goal.Set {
			goal = strings.TrimSpace(in.Goal.Value)
			checkLength(&fe, "goal", goal, 0, maxSprintGoal)
		}
		fe.Check(start != nil, "startDate", "is required")
		fe.Check(end != nil, "endDate", "is required")
		checkSprintDates(&fe, start, end)
		if err := fe.Err(); err != nil {
			return err
		}

		active, err := t.q.GetActiveSprint(ctx, p.ID)
		switch {
		case err == nil:
			return httpx.Conflict("%s is already active; complete it before starting another sprint", active.Name)
		case !isNoRows(err):
			return fmt.Errorf("load active sprint: %w", err)
		}
		started, err := t.q.StartSprint(ctx, db.StartSprintParams{
			ID: cur.ID, Name: name, Goal: goal, StartDate: start.TimePtr(), EndDate: end.TimePtr(),
		})
		if isUniqueViolation(err) { // sprints_one_active_idx
			return httpx.Conflict("Another sprint is already active; complete it before starting another sprint")
		}
		if err != nil {
			return fmt.Errorf("start sprint: %w", err)
		}
		if err := t.logActivity(ctx, userID, projectEntry(p.ID, ActionSprintStarted, started.Name)); err != nil {
			return err
		}
		t.publish(p.ID, realtime.SprintChanged, p.Key, "", userID)
		out, err = sprintView(ctx, t.q, started)
		return err
	})
	return out, err
}

// CompleteSprint completes the active sprint (member role). Its open standard issues
// (status category other than done) move to the target — the backlog, an existing planned
// sprint of the project, or a new planned sprint — and their subtasks follow them. Done
// issues stay in the completed sprint.
func (s *Service) CompleteSprint(ctx context.Context, userID, sprintID int64, in CompleteSprintInput) (dto.CompleteSprintResult, error) {
	target := strings.ToLower(strings.TrimSpace(in.Target))
	if target == "" {
		target = CompleteTargetBacklog
	}
	if !slices.Contains(completeTargets, target) {
		return dto.CompleteSprintResult{}, httpx.Validation("target", oneOf(completeTargets))
	}
	if target == CompleteTargetSprint && in.SprintID == nil {
		return dto.CompleteSprintResult{}, httpx.Validation("sprintId", "is required when target is sprint")
	}

	var out dto.CompleteSprintResult
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.lockSprint(ctx, t, userID, sprintID)
		if err != nil {
			return err
		}
		sp, p := acc.sprint, acc.project
		if sp.State != dto.SprintActive {
			return httpx.Conflict("Only the active sprint can be completed")
		}

		var dest *db.Sprint
		switch target {
		case CompleteTargetSprint:
			// A share lock is enough: it keeps the target from being started, completed or
			// deleted concurrently.
			d, err := t.q.GetSprintForShare(ctx, *in.SprintID)
			if isNoRows(err) || (err == nil && (d.ProjectID != p.ID || d.State != dto.SprintPlanned)) {
				return httpx.Validation("sprintId", "must be a planned sprint of this project")
			}
			if err != nil {
				return fmt.Errorf("load target sprint: %w", err)
			}
			dest = &d
		case CompleteTargetNew:
			d, err := t.createSprint(ctx, userID, p, "", "", nil, nil)
			if err != nil {
				return err
			}
			dest = &d
		}

		issues, err := t.q.ListSprintStandardIssues(ctx, sp.ID)
		if err != nil {
			return fmt.Errorf("list sprint issues: %w", err)
		}
		var open []int64
		for _, is := range issues {
			if is.Category != dto.CategoryDone {
				open = append(open, is.ID)
			}
		}
		var destID *int64
		if dest != nil {
			destID = &dest.ID
		}
		if err := t.moveIssuesToSprint(ctx, userID, open, destID); err != nil {
			return err
		}
		completed, err := t.q.CompleteSprint(ctx, sp.ID)
		if err != nil {
			return fmt.Errorf("complete sprint: %w", err)
		}
		if err := t.logActivity(ctx, userID, projectEntry(p.ID, ActionSprintCompleted, completed.Name)); err != nil {
			return err
		}
		t.publish(p.ID, realtime.SprintChanged, p.Key, "", userID)

		rows := []db.Sprint{completed}
		if dest != nil {
			rows = append(rows, *dest)
		}
		views, err := sprintViews(ctx, t.q, rows)
		if err != nil {
			return err
		}
		out = dto.CompleteSprintResult{
			Sprint:              views[0],
			CompletedIssueCount: int64(len(issues) - len(open)),
			MovedIssueCount:     int64(len(open)),
		}
		if dest != nil {
			out.TargetSprint = &views[1]
		}
		return nil
	})
	return out, err
}

// moveIssuesToSprint moves standard issues to a sprint (nil = backlog), logging a sprint
// change for each one that actually moves, and makes their subtasks follow.
func (t *txn) moveIssuesToSprint(ctx context.Context, actorID int64, issueIDs []int64, sprintID *int64) error {
	if len(issueIDs) == 0 {
		return nil
	}
	if err := t.q.LogIssueSprintChanges(ctx, db.LogIssueSprintChangesParams{ActorID: actorID, SprintID: sprintID, IssueIds: issueIDs}); err != nil {
		return fmt.Errorf("log sprint changes: %w", err)
	}
	if err := t.q.SetIssuesSprint(ctx, db.SetIssuesSprintParams{SprintID: sprintID, IssueIds: issueIDs}); err != nil {
		return fmt.Errorf("move issues to sprint: %w", err)
	}
	return t.syncSubtaskSprints(ctx, actorID, issueIDs)
}

// checkSprintDates validates that a sprint does not end before it starts.
func checkSprintDates(fe *httpx.FieldErrors, start, end *dto.Date) {
	if start != nil && end != nil && end.Time().Before(start.Time()) {
		fe.Add("endDate", "must be on or after the start date")
	}
}

// sprintViews renders sprints with their statistics (one query for all of them).
func sprintViews(ctx context.Context, q *db.Queries, rows []db.Sprint) ([]dto.Sprint, error) {
	out := make([]dto.Sprint, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]int64, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	stats, err := q.ListSprintStats(ctx, dedupeIDs(ids))
	if err != nil {
		return nil, fmt.Errorf("load sprint statistics: %w", err)
	}
	byID := make(map[int64]db.ListSprintStatsRow, len(stats))
	for _, st := range stats {
		byID[st.SprintID] = st
	}
	for i, r := range rows {
		out[i] = toSprint(r, byID[r.ID])
	}
	return out, nil
}

// sprintView renders one sprint with its statistics.
func sprintView(ctx context.Context, q *db.Queries, row db.Sprint) (dto.Sprint, error) {
	out, err := sprintViews(ctx, q, []db.Sprint{row})
	if err != nil {
		return dto.Sprint{}, err
	}
	return out[0], nil
}
