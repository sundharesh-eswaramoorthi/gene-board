package service

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/rank"
)

// Shared validation of issue references (SPEC §2 hierarchy / sprint rules). Every helper
// reports client mistakes as validation errors on the corresponding request field.

const msgSubtaskSprint = "must match the parent's sprint (subtasks always share their parent's sprint)"

// resolveIssueStatus loads a status of the project for the statusId field.
func resolveIssueStatus(ctx context.Context, q *db.Queries, projectID, statusID int64) (db.Status, error) {
	// FOR KEY SHARE keeps the status from being deleted until this write commits.
	st, err := q.GetStatusForKeyShare(ctx, statusID)
	st, err = statusInProject(st, err, projectID)
	if httpx.IsCode(err, httpx.CodeNotFound) {
		return db.Status{}, httpx.Validation("statusId", "must belong to this project")
	}
	return st, err
}

// defaultIssueStatus returns the project's first status by position.
func defaultIssueStatus(ctx context.Context, q *db.Queries, projectID int64) (db.Status, error) {
	statuses, err := q.ListStatuses(ctx, projectID)
	if err != nil {
		return db.Status{}, fmt.Errorf("list statuses: %w", err)
	}
	if len(statuses) == 0 {
		return db.Status{}, fmt.Errorf("project %d has no statuses", projectID)
	}
	return statuses[0], nil
}

// resolveParent validates the parent of an issue of type issueType:
// epics have no parent, standard issues may have an epic of the same project, subtasks
// require a standard issue of the same project. The parent row is share-locked for the
// rest of the transaction, so a subtask always copies its parent's current sprint (a
// concurrent sprint change of the parent waits, then syncs the new subtask).
func resolveParent(ctx context.Context, q *db.Queries, projectID int64, issueType string, parentID *int64) (*db.Issue, error) {
	switch {
	case issueType == dto.IssueTypeEpic:
		if parentID != nil {
			return nil, httpx.Validation("parentId", "must be empty for epics")
		}
		return nil, nil
	case parentID == nil:
		if issueType == dto.IssueTypeSubtask {
			return nil, httpx.Validation("parentId", "is required for subtasks")
		}
		return nil, nil
	}
	parent, err := q.GetIssueForShare(ctx, *parentID)
	if isNoRows(err) || (err == nil && parent.ProjectID != projectID) {
		return nil, httpx.Validation("parentId", "must be an issue of this project")
	}
	if err != nil {
		return nil, fmt.Errorf("load parent: %w", err)
	}
	if issueType == dto.IssueTypeSubtask && !isStandardType(parent.Type) {
		return nil, httpx.Validation("parentId", "must be a story, task or bug")
	}
	if isStandardType(issueType) && parent.Type != dto.IssueTypeEpic {
		return nil, httpx.Validation("parentId", "must be an epic")
	}
	return &parent, nil
}

// resolveSprint validates that sprintID is a planned or active sprint of the project. The
// sprint row is share-locked for the rest of the transaction so that it cannot be
// completed or deleted while an issue is being put into it.
func resolveSprint(ctx context.Context, q *db.Queries, projectID, sprintID int64) (db.Sprint, error) {
	sp, err := q.GetSprintForShare(ctx, sprintID)
	if isNoRows(err) || (err == nil && sp.ProjectID != projectID) {
		return db.Sprint{}, httpx.Validation("sprintId", "must be a sprint of this project")
	}
	if err != nil {
		return db.Sprint{}, fmt.Errorf("load sprint: %w", err)
	}
	if sp.State == dto.SprintCompleted {
		return db.Sprint{}, httpx.Validation("sprintId", "must not be a completed sprint")
	}
	return sp, nil
}

// parentSprint returns the sprint of the given parent issue (nil for no parent/sprint).
func parentSprint(ctx context.Context, q *db.Queries, parentID *int64) (*int64, error) {
	if parentID == nil {
		return nil, nil
	}
	parent, err := q.GetIssueByID(ctx, *parentID)
	if err != nil {
		return nil, fmt.Errorf("load parent: %w", err)
	}
	return parent.SprintID, nil
}

// resolveLabels validates label ids (duplicates ignored) and returns the labels sorted by
// name. A nil/empty slice yields no labels. The labels are key-share locked, so one deleted
// concurrently is reported as invalid instead of failing the insert with a foreign-key
// violation.
func resolveLabels(ctx context.Context, q *db.Queries, projectID int64, ids []int64) ([]db.Label, error) {
	ids = dedupeIDs(ids)
	if len(ids) == 0 {
		return []db.Label{}, nil
	}
	labels, err := q.LockLabelsByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("load labels: %w", err)
	}
	if len(labels) != len(ids) || slices.ContainsFunc(labels, func(l db.Label) bool { return l.ProjectID != projectID }) {
		return nil, httpx.Validation("labelIds", "must all belong to this project")
	}
	return labels, nil
}

// currentLabels returns the labels of one issue sorted by name.
func currentLabels(ctx context.Context, q *db.Queries, issueID int64) ([]db.Label, error) {
	rows, err := q.ListIssueLabels(ctx, []int64{issueID})
	if err != nil {
		return nil, fmt.Errorf("load issue labels: %w", err)
	}
	out := make([]db.Label, len(rows))
	for i, r := range rows {
		out[i] = r.Label
	}
	return out, nil
}

func sameLabelSet(a, b []db.Label) bool {
	ids := func(ls []db.Label) []int64 {
		out := make([]int64, len(ls))
		for i, l := range ls {
			out[i] = l.ID
		}
		slices.Sort(out)
		return out
	}
	return slices.Equal(ids(a), ids(b))
}

// setIssueLabels replaces the label set of an issue.
func setIssueLabels(ctx context.Context, q *db.Queries, issueID int64, labels []db.Label) error {
	if err := q.ClearIssueLabels(ctx, issueID); err != nil {
		return fmt.Errorf("clear labels: %w", err)
	}
	if len(labels) == 0 {
		return nil
	}
	ids := make([]int64, len(labels))
	for i, l := range labels {
		ids[i] = l.ID
	}
	if err := q.AddIssueLabels(ctx, db.AddIssueLabelsParams{IssueID: issueID, LabelIds: ids}); err != nil {
		return fmt.Errorf("add labels: %w", err)
	}
	return nil
}

func checkStoryPoints(fe *httpx.FieldErrors, points *float64) {
	if points != nil && (*points < 0 || *points > maxStoryPoints) {
		fe.Add("storyPoints", fmt.Sprintf("must be between 0 and %d", maxStoryPoints))
	}
}

// resolvedAtFor computes resolved_at after a status change: set when entering a
// done-category status, kept while staying in one, cleared when leaving.
func resolvedAtFor(current *time.Time, oldCategory, newCategory string, now time.Time) *time.Time {
	switch {
	case newCategory != dto.CategoryDone:
		return nil
	case oldCategory == dto.CategoryDone && current != nil:
		return current
	default:
		return &now
	}
}

// syncSubtaskSprints makes every subtask of the given parents share its parent's current
// sprint, logging a sprint change for each subtask that moves. Call it after changing the
// parents' sprint_id inside the same transaction (issue PATCH/move, sprint completion).
func (t *txn) syncSubtaskSprints(ctx context.Context, actorID int64, parentIDs []int64) error {
	if len(parentIDs) == 0 {
		return nil
	}
	if err := t.q.LogSubtaskSprintSync(ctx, db.LogSubtaskSprintSyncParams{ActorID: actorID, ParentIds: parentIDs}); err != nil {
		return fmt.Errorf("log subtask sprint sync: %w", err)
	}
	if _, err := t.q.SyncSubtaskSprints(ctx, parentIDs); err != nil {
		return fmt.Errorf("sync subtask sprints: %w", err)
	}
	return nil
}

// moveRank computes the new rank for a drag & drop move. prevID / nextID are the issues
// that will be immediately above / below the moved issue in the destination list.
//
// The result is always strictly between two *adjacent* ranks of the project, so ranks stay
// unique project-wide:
//   - prev given: between prev and the next rank after it (this also covers a stale
//     client whose prev >= next, which the spec resolves as "right after prev");
//   - only next given: between the rank before next and next;
//   - neither: the rank is unchanged.
func moveRank(ctx context.Context, q *db.Queries, issue db.Issue, prevID, nextID *int64) (string, error) {
	if prevID == nil && nextID == nil {
		return issue.Rank, nil
	}
	neighbour := func(field string, id *int64) (*db.Issue, error) {
		if id == nil {
			return nil, nil
		}
		if *id == issue.ID {
			return nil, httpx.Validation(field, "cannot be the moved issue itself")
		}
		n, err := q.GetIssueByID(ctx, *id)
		if isNoRows(err) || (err == nil && n.ProjectID != issue.ProjectID) {
			return nil, httpx.Validation(field, "must be an issue of this project")
		}
		if err != nil {
			return nil, fmt.Errorf("load neighbour: %w", err)
		}
		return &n, nil
	}
	prev, err := neighbour("prevIssueId", prevID)
	if err != nil {
		return "", err
	}
	next, err := neighbour("nextIssueId", nextID)
	if err != nil {
		return "", err
	}

	var lo, hi string
	if prev != nil {
		lo = prev.Rank
		hi, err = q.RankAfter(ctx, db.RankAfterParams{ProjectID: issue.ProjectID, Rank: lo, ExcludeID: issue.ID})
	} else {
		hi = next.Rank
		lo, err = q.RankBefore(ctx, db.RankBeforeParams{ProjectID: issue.ProjectID, Rank: hi, ExcludeID: issue.ID})
	}
	if err != nil {
		return "", fmt.Errorf("load neighbouring rank: %w", err)
	}
	r, err := rank.Between(lo, hi)
	if err != nil {
		return "", fmt.Errorf("compute rank between %q and %q: %w", lo, hi, err)
	}
	return r, nil
}

// --- activity value formatting ---

// fieldChange is one changed issue field, rendered for the activity log.
type fieldChange struct {
	field    string
	oldValue *string
	newValue *string
}

// changeLookups holds the rows needed to render old/new values of an issue change.
type changeLookups struct {
	statuses map[int64]db.Status
	users    map[int64]db.User
	issues   map[int64]db.Issue
	sprints  map[int64]db.Sprint
}

// loadChangeLookups loads (in at most four queries) every status, user, parent issue and
// sprint referenced by either version of the issue.
func loadChangeLookups(ctx context.Context, q *db.Queries, cur, next db.Issue) (changeLookups, error) {
	var (
		l   changeLookups
		err error
	)
	if l.statuses, err = statusesByID(ctx, q, []int64{cur.StatusID, next.StatusID}); err != nil {
		return l, err
	}
	if l.users, err = usersByID(ctx, q, nonNil(cur.AssigneeID, next.AssigneeID, cur.ReporterID, next.ReporterID)); err != nil {
		return l, err
	}
	if l.issues, err = issuesByID(ctx, q, nonNil(cur.ParentID, next.ParentID)); err != nil {
		return l, err
	}
	if l.sprints, err = sprintsByID(ctx, q, nonNil(cur.SprintID, next.SprintID)); err != nil {
		return l, err
	}
	return l, nil
}

// describeIssueChanges lists the changed fields in the order of SPEC §2 with
// human-readable old/new values. Labels are compared only when labelsChanged is true.
func describeIssueChanges(cur, next db.Issue, l changeLookups, oldLabels, newLabels []db.Label, labelsChanged bool) []fieldChange {
	var out []fieldChange
	add := func(field string, oldValue, newValue *string) {
		out = append(out, fieldChange{field: field, oldValue: oldValue, newValue: newValue})
	}
	userName := func(id *int64) *string {
		if id == nil {
			return nil
		}
		if u, ok := l.users[*id]; ok {
			return &u.Name
		}
		return nil
	}
	issueKey := func(id *int64) *string {
		if id == nil {
			return nil
		}
		if i, ok := l.issues[*id]; ok {
			return &i.Key
		}
		return nil
	}
	sprintName := func(id *int64) *string {
		if id == nil {
			return nil
		}
		if s, ok := l.sprints[*id]; ok {
			return &s.Name
		}
		return nil
	}

	if cur.Summary != next.Summary {
		add("summary", ptr(cur.Summary), ptr(next.Summary))
	}
	if cur.Description != next.Description {
		add("description", nil, nil)
	}
	if cur.Type != next.Type {
		add("type", ptr(cur.Type), ptr(next.Type))
	}
	if cur.StatusID != next.StatusID {
		add("status", ptr(l.statuses[cur.StatusID].Name), ptr(l.statuses[next.StatusID].Name))
	}
	if cur.Priority != next.Priority {
		add("priority", ptr(cur.Priority), ptr(next.Priority))
	}
	if !equalPtr(cur.AssigneeID, next.AssigneeID) {
		add("assignee", userName(cur.AssigneeID), userName(next.AssigneeID))
	}
	if !equalPtr(cur.ReporterID, next.ReporterID) {
		add("reporter", userName(cur.ReporterID), userName(next.ReporterID))
	}
	if !equalPtr(cur.ParentID, next.ParentID) {
		add("parent", issueKey(cur.ParentID), issueKey(next.ParentID))
	}
	if !equalPtr(cur.SprintID, next.SprintID) {
		add("sprint", sprintName(cur.SprintID), sprintName(next.SprintID))
	}
	if !equalPtr(cur.StoryPoints, next.StoryPoints) {
		add("storyPoints", formatPoints(cur.StoryPoints), formatPoints(next.StoryPoints))
	}
	if !equalDate(cur.DueDate, next.DueDate) {
		add("dueDate", formatDate(cur.DueDate), formatDate(next.DueDate))
	}
	if labelsChanged {
		add("labels", joinLabelNames(oldLabels), joinLabelNames(newLabels))
	}
	return out
}

func nonNil(ids ...*int64) []int64 {
	var out []int64
	for _, id := range ids {
		if id != nil {
			out = append(out, *id)
		}
	}
	return out
}

func formatPoints(p *float64) *string {
	if p == nil {
		return nil
	}
	return ptr(strconv.FormatFloat(*p, 'f', -1, 64))
}

func formatDate(t *time.Time) *string {
	if t == nil {
		return nil
	}
	return ptr(dto.NewDate(*t).String())
}

// equalDate compares nullable DATE values by calendar date.
func equalDate(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return dto.NewDate(*a) == dto.NewDate(*b)
}

// joinLabelNames renders a label set as "a, b, c" (null when empty).
func joinLabelNames(labels []db.Label) *string {
	if len(labels) == 0 {
		return nil
	}
	return ptr(strings.Join(sortedLabelNames(labels), ", "))
}
