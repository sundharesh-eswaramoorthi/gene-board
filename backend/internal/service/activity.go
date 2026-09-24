package service

import (
	"context"
	"fmt"

	"geneboard/internal/db"
	"geneboard/internal/dto"
)

// Activity actions (SPEC §2 Activity log).
const (
	ActionIssueCreated    = "issue.created"
	ActionIssueUpdated    = "issue.updated"
	ActionIssueDeleted    = "issue.deleted"
	ActionCommentCreated  = "comment.created"
	ActionLinkCreated     = "link.created"
	ActionLinkDeleted     = "link.deleted"
	ActionSprintCreated   = "sprint.created"
	ActionSprintStarted   = "sprint.started"
	ActionSprintCompleted = "sprint.completed"
	ActionProjectCreated  = "project.created"
	ActionMemberAdded     = "member.added"
	ActionMemberRemoved   = "member.removed"
)

// Activity limits for list endpoints.
const (
	DefaultProjectActivityLimit = 50
	DefaultFeedActivityLimit    = 30
	MaxActivityLimit            = 200
)

// activityEntry is one row to append to the activity log.
type activityEntry struct {
	ProjectID int64
	IssueID   *int64  // nil for project-level entries and deleted issues
	IssueKey  *string // kept even when IssueID is nil (issue.deleted)
	Action    string
	Field     *string
	OldValue  *string
	NewValue  *string
}

// projectEntry returns a project-level entry (no issue).
func projectEntry(projectID int64, action string, newValue string) activityEntry {
	return activityEntry{ProjectID: projectID, Action: action, NewValue: &newValue}
}

// issueEntry returns an entry attached to issue.
func issueEntry(issue db.Issue, action string) activityEntry {
	id, key := issue.ID, issue.Key
	return activityEntry{ProjectID: issue.ProjectID, IssueID: &id, IssueKey: &key, Action: action}
}

// withValues sets field / old / new (an empty field name means null).
func (e activityEntry) withValues(field string, oldValue, newValue *string) activityEntry {
	if field != "" {
		e.Field = &field
	}
	e.OldValue, e.NewValue = oldValue, newValue
	return e
}

// logActivity appends an entry to the activity log inside the transaction.
func (t *txn) logActivity(ctx context.Context, actorID int64, e activityEntry) error {
	err := t.q.CreateActivity(ctx, db.CreateActivityParams{
		ProjectID: e.ProjectID,
		IssueID:   e.IssueID,
		IssueKey:  e.IssueKey,
		ActorID:   &actorID,
		Action:    e.Action,
		Field:     e.Field,
		OldValue:  e.OldValue,
		NewValue:  e.NewValue,
	})
	if err != nil {
		return fmt.Errorf("log activity %s: %w", e.Action, err)
	}
	return nil
}

// activityView is the column set shared by every activity list query; the generated row
// types convert to it directly.
type activityView struct {
	Activity   db.Activity
	ProjectKey string
	ActorName  *string
	ActorEmail *string
}

func toActivity(v activityView) dto.Activity {
	a := v.Activity
	out := dto.Activity{
		ID:         a.ID,
		ProjectID:  a.ProjectID,
		ProjectKey: v.ProjectKey,
		IssueID:    a.IssueID,
		IssueKey:   a.IssueKey,
		Action:     a.Action,
		Field:      a.Field,
		OldValue:   a.OldValue,
		NewValue:   a.NewValue,
		CreatedAt:  dto.TS(a.CreatedAt),
	}
	if a.ActorID != nil && v.ActorName != nil {
		out.Actor = &dto.UserSummary{ID: *a.ActorID, Name: *v.ActorName, Email: deref(v.ActorEmail)}
	}
	return out
}

func toActivities[T ~struct {
	Activity   db.Activity `db:"activity"`
	ProjectKey string      `db:"project_key"`
	ActorName  *string     `db:"actor_name"`
	ActorEmail *string     `db:"actor_email"`
}](rows []T) []dto.Activity {
	out := make([]dto.Activity, len(rows))
	for i, r := range rows {
		out[i] = toActivity(activityView(r))
	}
	return out
}

// IssueActivity returns the history of an issue, newest first.
func (s *Service) IssueActivity(ctx context.Context, userID int64, issueKey string) ([]dto.Activity, error) {
	acc, err := s.issueByKey(ctx, s.q, userID, issueKey, RoleViewer)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListIssueActivities(ctx, acc.issue.ID)
	if err != nil {
		return nil, fmt.Errorf("list issue activity: %w", err)
	}
	return toActivities(rows), nil
}

// ProjectActivity returns a page of a project's activity, newest first.
func (s *Service) ProjectActivity(ctx context.Context, userID int64, projectKey string, limit, offset int) ([]dto.Activity, error) {
	acc, err := s.projectByKey(ctx, s.q, userID, projectKey, RoleViewer)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListProjectActivities(ctx, db.ListProjectActivitiesParams{
		ProjectID:  acc.project.ID,
		MaxResults: int32(clampLimit(limit, DefaultProjectActivityLimit, MaxActivityLimit)),
		Skip:       int64(max(offset, 0)), // bigint: any offset the handler accepts is valid
	})
	if err != nil {
		return nil, fmt.Errorf("list project activity: %w", err)
	}
	return toActivities(rows), nil
}

// ActivityFeed returns recent activity across all of the user's projects, newest first.
func (s *Service) ActivityFeed(ctx context.Context, userID int64, limit, offset int) ([]dto.Activity, error) {
	rows, err := s.q.ListUserFeedActivities(ctx, db.ListUserFeedActivitiesParams{
		UserID:     userID,
		MaxResults: int32(clampLimit(limit, DefaultFeedActivityLimit, MaxActivityLimit)),
		Skip:       int64(max(offset, 0)), // bigint: any offset the handler accepts is valid
	})
	if err != nil {
		return nil, fmt.Errorf("list activity feed: %w", err)
	}
	return toActivities(rows), nil
}

// clampLimit returns def for non-positive limits and caps the rest at maxLimit.
func clampLimit(limit, def, maxLimit int) int {
	if limit <= 0 {
		return def
	}
	return min(limit, maxLimit)
}
