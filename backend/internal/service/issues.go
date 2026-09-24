package service

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/rank"
	"geneboard/internal/realtime"
)

// CreateIssueInput is the body of POST /projects/{key}/issues.
// reporterId: absent = the caller, null = no reporter.
type CreateIssueInput struct {
	Type        string                `json:"type"`
	Summary     string                `json:"summary"`
	Description string                `json:"description"`
	StatusID    *int64                `json:"statusId"`
	Priority    string                `json:"priority"`
	AssigneeID  *int64                `json:"assigneeId"`
	ReporterID  httpx.Optional[int64] `json:"reporterId,omitzero"`
	ParentID    *int64                `json:"parentId"`
	SprintID    *int64                `json:"sprintId"`
	StoryPoints *float64              `json:"storyPoints"`
	DueDate     *dto.Date             `json:"dueDate"`
	LabelIDs    []int64               `json:"labelIds"`
}

// UpdateIssueInput is the body of PATCH /issues/{issueKey} (PATCH semantics; labelIds
// replaces the whole set).
type UpdateIssueInput struct {
	Type        httpx.Optional[string]   `json:"type,omitzero"`
	Summary     httpx.Optional[string]   `json:"summary,omitzero"`
	Description httpx.Optional[string]   `json:"description,omitzero"`
	StatusID    httpx.Optional[int64]    `json:"statusId,omitzero"`
	Priority    httpx.Optional[string]   `json:"priority,omitzero"`
	AssigneeID  httpx.Optional[int64]    `json:"assigneeId,omitzero"`
	ReporterID  httpx.Optional[int64]    `json:"reporterId,omitzero"`
	ParentID    httpx.Optional[int64]    `json:"parentId,omitzero"`
	SprintID    httpx.Optional[int64]    `json:"sprintId,omitzero"`
	StoryPoints httpx.Optional[float64]  `json:"storyPoints,omitzero"`
	DueDate     httpx.Optional[dto.Date] `json:"dueDate,omitzero"`
	LabelIDs    httpx.Optional[[]int64]  `json:"labelIds,omitzero"`
}

// MoveIssueInput is the body of POST /issues/{issueKey}/move.
// sprintId: absent = unchanged, null = backlog. prevIssueId / nextIssueId: the issues
// immediately above / below in the destination list (null or absent = list edge).
type MoveIssueInput struct {
	StatusID    httpx.Optional[int64] `json:"statusId,omitzero"`
	SprintID    httpx.Optional[int64] `json:"sprintId,omitzero"`
	PrevIssueID httpx.Optional[int64] `json:"prevIssueId,omitzero"`
	NextIssueID httpx.Optional[int64] `json:"nextIssueId,omitzero"`
}

// GetIssue returns an issue with its children and links.
func (s *Service) GetIssue(ctx context.Context, userID int64, issueKey string) (dto.IssueDetail, error) {
	acc, err := s.issueByKey(ctx, s.q, userID, issueKey, RoleViewer)
	if err != nil {
		return dto.IssueDetail{}, err
	}
	return issueDetail(ctx, s.q, userID, acc.issue)
}

// CreateIssue creates an issue in the project, numbered from the project's counter and
// ranked last.
func (s *Service) CreateIssue(ctx context.Context, userID int64, projectKey string, in CreateIssueInput) (dto.IssueDetail, error) {
	issueType := strings.ToLower(strings.TrimSpace(in.Type))
	summary := strings.TrimSpace(in.Summary)
	description := strings.TrimSpace(in.Description)
	priority := strings.ToLower(strings.TrimSpace(in.Priority))
	if priority == "" {
		priority = dto.PriorityMedium
	}
	var fe httpx.FieldErrors
	checkEnum(&fe, "type", issueType, issueTypes)
	checkLength(&fe, "summary", summary, 1, maxSummary)
	checkLength(&fe, "description", description, 0, maxIssueDesc)
	checkEnum(&fe, "priority", priority, priorities)
	checkStoryPoints(&fe, in.StoryPoints)
	if err := fe.Err(); err != nil {
		return dto.IssueDetail{}, err
	}

	var out dto.IssueDetail
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, projectKey, RoleMember)
		if err != nil {
			return err
		}
		p := acc.project
		// Lock order: project row, then issues, then sprints (see lockSprint). Taking the
		// project lock first keeps resolveSprint's share lock from deadlocking with sprint
		// completion / deletion.
		if err := t.q.LockProject(ctx, p.ID); err != nil {
			return fmt.Errorf("lock project: %w", err)
		}

		var status db.Status
		if in.StatusID != nil {
			status, err = resolveIssueStatus(ctx, t.q, p.ID, *in.StatusID)
		} else {
			status, err = defaultIssueStatus(ctx, t.q, p.ID)
		}
		if err != nil {
			return err
		}
		if in.AssigneeID != nil {
			if err := requireMember(ctx, t.q, p.ID, *in.AssigneeID, "assigneeId"); err != nil {
				return err
			}
		}
		reporterID := &userID
		if in.ReporterID.Set {
			reporterID = in.ReporterID.Ptr()
			if reporterID != nil && *reporterID != userID {
				if err := requireMember(ctx, t.q, p.ID, *reporterID, "reporterId"); err != nil {
					return err
				}
			}
		}
		parent, err := resolveParent(ctx, t.q, p.ID, issueType, in.ParentID)
		if err != nil {
			return err
		}
		var sprintID *int64
		switch {
		case issueType == dto.IssueTypeEpic:
			if in.SprintID != nil {
				return httpx.Validation("sprintId", "must be empty for epics")
			}
		case issueType == dto.IssueTypeSubtask:
			// Subtasks inherit the parent's sprint; a conflicting explicit value is rejected.
			if in.SprintID != nil && !equalPtr(in.SprintID, parent.SprintID) {
				return httpx.Validation("sprintId", msgSubtaskSprint)
			}
			sprintID = parent.SprintID
		case in.SprintID != nil:
			if _, err := resolveSprint(ctx, t.q, p.ID, *in.SprintID); err != nil {
				return err
			}
			sprintID = in.SprintID
		}
		labels, err := resolveLabels(ctx, t.q, p.ID, in.LabelIDs)
		if err != nil {
			return err
		}

		number, err := t.q.NextIssueNumber(ctx, p.ID) // also locks the project row
		if err != nil {
			return fmt.Errorf("next issue number: %w", err)
		}
		maxRank, err := t.q.MaxIssueRank(ctx, p.ID)
		if err != nil {
			return fmt.Errorf("max rank: %w", err)
		}
		issueRank, err := rank.Between(maxRank, "")
		if err != nil {
			return fmt.Errorf("compute rank after %q: %w", maxRank, err)
		}
		var resolvedAt *time.Time
		if status.Category == dto.CategoryDone {
			now, err := t.now(ctx)
			if err != nil {
				return err
			}
			resolvedAt = resolvedAtFor(nil, "", status.Category, now)
		}
		issue, err := t.q.CreateIssue(ctx, db.CreateIssueParams{
			ProjectID:   p.ID,
			Number:      number,
			Key:         fmt.Sprintf("%s-%d", p.Key, number),
			Type:        issueType,
			Summary:     summary,
			Description: description,
			StatusID:    status.ID,
			Priority:    priority,
			AssigneeID:  in.AssigneeID,
			ReporterID:  reporterID,
			ParentID:    in.ParentID,
			SprintID:    sprintID,
			StoryPoints: in.StoryPoints,
			DueDate:     in.DueDate.TimePtr(),
			Rank:        issueRank,
			ResolvedAt:  resolvedAt,
		})
		if err != nil {
			return fmt.Errorf("create issue: %w", err)
		}
		if err := setIssueLabels(ctx, t.q, issue.ID, labels); err != nil {
			return err
		}
		if err := t.logActivity(ctx, userID, issueEntry(issue, ActionIssueCreated).withValues("", nil, &issue.Summary)); err != nil {
			return err
		}
		t.publish(p.ID, realtime.IssueCreated, p.Key, issue.Key, userID)
		out, err = issueDetail(ctx, t.q, userID, issue)
		return err
	})
	return out, err
}

// UpdateIssue applies a PATCH. Only changed fields are written and logged (one activity
// row per field); if nothing changes, nothing is written and updatedAt stays the same.
func (s *Service) UpdateIssue(ctx context.Context, userID int64, issueKey string, in UpdateIssueInput) (dto.IssueDetail, error) {
	var out dto.IssueDetail
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.issueByKey(ctx, t.q, userID, issueKey, RoleMember)
		if err != nil {
			return err
		}
		// Lock order shared by every issue write and the sprint / status / member changes
		// (see sprints.go): the project row first, then the issue, then the rows it refers
		// to. Without it a status or parent change could deadlock with, or slip past, a
		// sprint being completed.
		if err := t.q.LockProject(ctx, acc.project.ID); err != nil {
			return fmt.Errorf("lock project: %w", err)
		}
		cur, err := lockIssue(ctx, t.q, acc.issue.ID)
		if err != nil {
			return err
		}
		pid := cur.ProjectID
		next := cur

		// Plain fields.
		var fe httpx.FieldErrors
		if in.Type.Set {
			v := strings.ToLower(strings.TrimSpace(in.Type.Value))
			switch {
			case in.Type.Null:
				fe.Add("type", "must not be null")
			case !slices.Contains(issueTypes, v):
				fe.Add("type", oneOf(issueTypes))
			case v != cur.Type && !(isStandardType(cur.Type) && isStandardType(v)):
				fe.Add("type", "can only be changed between story, task and bug")
			default:
				next.Type = v
			}
		}
		if in.Summary.Set {
			if in.Summary.Null {
				fe.Add("summary", "must not be null")
			} else {
				next.Summary = strings.TrimSpace(in.Summary.Value)
				checkLength(&fe, "summary", next.Summary, 1, maxSummary)
			}
		}
		if in.Description.Set {
			next.Description = strings.TrimSpace(in.Description.Value) // null clears
			checkLength(&fe, "description", next.Description, 0, maxIssueDesc)
		}
		if in.Priority.Set {
			if in.Priority.Null {
				fe.Add("priority", "must not be null")
			} else {
				next.Priority = strings.ToLower(strings.TrimSpace(in.Priority.Value))
				checkEnum(&fe, "priority", next.Priority, priorities)
			}
		}
		if in.StoryPoints.Set {
			next.StoryPoints = in.StoryPoints.Ptr()
			checkStoryPoints(&fe, next.StoryPoints)
		}
		if in.DueDate.Set {
			next.DueDate = in.DueDate.Ptr().TimePtr()
		}
		if in.StatusID.Set && in.StatusID.Null {
			fe.Add("statusId", "must not be null")
		}
		if err := fe.Err(); err != nil {
			return err
		}

		// References.
		if in.StatusID.HasValue() && in.StatusID.Value != cur.StatusID {
			st, err := resolveIssueStatus(ctx, t.q, pid, in.StatusID.Value)
			if err != nil {
				return err
			}
			next.StatusID = st.ID
		}
		if in.AssigneeID.Set && !equalPtr(in.AssigneeID.Ptr(), cur.AssigneeID) {
			next.AssigneeID = in.AssigneeID.Ptr()
			if next.AssigneeID != nil {
				if err := requireMember(ctx, t.q, pid, *next.AssigneeID, "assigneeId"); err != nil {
					return err
				}
			}
		}
		if in.ReporterID.Set && !equalPtr(in.ReporterID.Ptr(), cur.ReporterID) {
			next.ReporterID = in.ReporterID.Ptr()
			if next.ReporterID != nil {
				if err := requireMember(ctx, t.q, pid, *next.ReporterID, "reporterId"); err != nil {
					return err
				}
			}
		}
		var parent *db.Issue // the parent after the update, when loaded
		if in.ParentID.Set && !equalPtr(in.ParentID.Ptr(), cur.ParentID) {
			if parent, err = resolveParent(ctx, t.q, pid, next.Type, in.ParentID.Ptr()); err != nil {
				return err
			}
			next.ParentID = in.ParentID.Ptr()
		}
		switch {
		case next.Type == dto.IssueTypeEpic:
			if in.SprintID.HasValue() {
				return httpx.Validation("sprintId", "must be empty for epics")
			}
		case next.Type == dto.IssueTypeSubtask:
			var parentSprintID *int64
			if parent != nil {
				parentSprintID = parent.SprintID
			} else if parentSprintID, err = parentSprint(ctx, t.q, next.ParentID); err != nil {
				return err
			}
			if in.SprintID.Set && !equalPtr(in.SprintID.Ptr(), parentSprintID) {
				return httpx.Validation("sprintId", msgSubtaskSprint)
			}
			next.SprintID = parentSprintID // follows a new parent
		case in.SprintID.Set && !equalPtr(in.SprintID.Ptr(), cur.SprintID):
			if in.SprintID.HasValue() {
				if _, err := resolveSprint(ctx, t.q, pid, in.SprintID.Value); err != nil {
					return err
				}
			}
			next.SprintID = in.SprintID.Ptr()
		}
		oldLabels, err := currentLabels(ctx, t.q, cur.ID)
		if err != nil {
			return err
		}
		newLabels, labelsChanged := oldLabels, false
		if in.LabelIDs.Set {
			resolved, err := resolveLabels(ctx, t.q, pid, in.LabelIDs.Value) // null clears
			if err != nil {
				return err
			}
			if !sameLabelSet(oldLabels, resolved) {
				newLabels, labelsChanged = resolved, true
			}
		}

		lookups, err := loadChangeLookups(ctx, t.q, cur, next)
		if err != nil {
			return err
		}
		changes := describeIssueChanges(cur, next, lookups, oldLabels, newLabels, labelsChanged)
		if len(changes) == 0 {
			out, err = issueDetail(ctx, t.q, userID, cur)
			return err
		}
		if next.ResolvedAt, err = t.resolvedAtAfter(ctx, cur, next, lookups); err != nil {
			return err
		}
		updated, err := t.writeIssueChanges(ctx, userID, cur, next, changes)
		if err != nil {
			return err
		}
		if labelsChanged {
			if err := setIssueLabels(ctx, t.q, updated.ID, newLabels); err != nil {
				return err
			}
		}
		t.publish(pid, realtime.IssueUpdated, projectKeyOf(updated.Key), updated.Key, userID)
		out, err = issueDetail(ctx, t.q, userID, updated)
		return err
	})
	return out, err
}

// resolvedAtAfter returns next's resolved_at: unchanged unless the status changes, then
// derived from the old and new status categories using the transaction clock.
func (t *txn) resolvedAtAfter(ctx context.Context, cur, next db.Issue, l changeLookups) (*time.Time, error) {
	if next.StatusID == cur.StatusID {
		return next.ResolvedAt, nil
	}
	now, err := t.now(ctx)
	if err != nil {
		return nil, err
	}
	return resolvedAtFor(cur.ResolvedAt, l.statuses[cur.StatusID].Category, l.statuses[next.StatusID].Category, now), nil
}

// writeIssueChanges persists next (bumping updated_at), logs one activity row per change
// and keeps subtasks in their parent's sprint.
func (t *txn) writeIssueChanges(ctx context.Context, actorID int64, cur, next db.Issue, changes []fieldChange) (db.Issue, error) {
	updated, err := t.q.UpdateIssue(ctx, db.UpdateIssueParams{
		ID:          next.ID,
		Type:        next.Type,
		Summary:     next.Summary,
		Description: next.Description,
		StatusID:    next.StatusID,
		Priority:    next.Priority,
		AssigneeID:  next.AssigneeID,
		ReporterID:  next.ReporterID,
		ParentID:    next.ParentID,
		SprintID:    next.SprintID,
		StoryPoints: next.StoryPoints,
		DueDate:     next.DueDate,
		ResolvedAt:  next.ResolvedAt,
	})
	if err != nil {
		return db.Issue{}, fmt.Errorf("update issue: %w", err)
	}
	for _, c := range changes {
		entry := issueEntry(updated, ActionIssueUpdated).withValues(c.field, c.oldValue, c.newValue)
		if err := t.logActivity(ctx, actorID, entry); err != nil {
			return db.Issue{}, err
		}
	}
	if isStandardType(updated.Type) && !equalPtr(cur.SprintID, updated.SprintID) {
		if err := t.syncSubtaskSprints(ctx, actorID, []int64{updated.ID}); err != nil {
			return db.Issue{}, err
		}
	}
	return updated, nil
}

// MoveIssue handles drag & drop: an optional status change, an optional sprint change
// (standard issues take their subtasks along) and re-ranking between neighbours.
// Rank-only moves are not logged and do not touch updatedAt.
func (s *Service) MoveIssue(ctx context.Context, userID int64, issueKey string, in MoveIssueInput) (dto.Issue, error) {
	if in.StatusID.Set && in.StatusID.Null {
		return dto.Issue{}, httpx.Validation("statusId", "must not be null")
	}
	var out dto.Issue
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.issueByKey(ctx, t.q, userID, issueKey, RoleMember)
		if err != nil {
			return err
		}
		if acc.issue.Type == dto.IssueTypeEpic {
			return invalid("Epics cannot be moved on boards or backlogs")
		}
		pid := acc.project.ID
		if err := t.q.LockProject(ctx, pid); err != nil { // serialises rank computations
			return fmt.Errorf("lock project: %w", err)
		}
		cur, err := lockIssue(ctx, t.q, acc.issue.ID)
		if err != nil {
			return err
		}
		next := cur

		if in.StatusID.HasValue() && in.StatusID.Value != cur.StatusID {
			st, err := resolveIssueStatus(ctx, t.q, pid, in.StatusID.Value)
			if err != nil {
				return err
			}
			next.StatusID = st.ID
		}
		if in.SprintID.Set {
			requested := in.SprintID.Ptr()
			if cur.Type == dto.IssueTypeSubtask {
				parentSprintID, err := parentSprint(ctx, t.q, cur.ParentID)
				if err != nil {
					return err
				}
				if !equalPtr(requested, parentSprintID) {
					return httpx.Validation("sprintId", msgSubtaskSprint)
				}
			} else if !equalPtr(requested, cur.SprintID) {
				if requested != nil {
					if _, err := resolveSprint(ctx, t.q, pid, *requested); err != nil {
						return err
					}
				}
				next.SprintID = requested
			}
		}
		newRank, err := moveRank(ctx, t.q, cur, in.PrevIssueID.Ptr(), in.NextIssueID.Ptr())
		if err != nil {
			return err
		}

		updated := cur
		lookups, err := loadChangeLookups(ctx, t.q, cur, next)
		if err != nil {
			return err
		}
		if changes := describeIssueChanges(cur, next, lookups, nil, nil, false); len(changes) > 0 {
			if next.ResolvedAt, err = t.resolvedAtAfter(ctx, cur, next, lookups); err != nil {
				return err
			}
			if updated, err = t.writeIssueChanges(ctx, userID, cur, next, changes); err != nil {
				return err
			}
		}
		if newRank != cur.Rank {
			if updated, err = t.q.SetIssueRank(ctx, db.SetIssueRankParams{ID: cur.ID, Rank: newRank}); err != nil {
				return fmt.Errorf("set rank: %w", err)
			}
		}
		t.publish(pid, realtime.IssueMoved, acc.project.Key, cur.Key, userID)
		out, err = hydrateIssue(ctx, t.q, updated)
		return err
	})
	return out, err
}

// DeleteIssue deletes an issue and its subtasks; other children (issues of a deleted epic)
// become parentless. Every deleted issue gets an issue.deleted activity row.
func (s *Service) DeleteIssue(ctx context.Context, userID int64, issueKey string) error {
	return s.inTx(ctx, func(t *txn) error {
		acc, err := s.issueByKey(ctx, t.q, userID, issueKey, RoleMember)
		if err != nil {
			return err
		}
		// Project lock first (see UpdateIssue): deleting also rewrites children and
		// subtasks, which sprint and status changes lock too.
		if err := t.q.LockProject(ctx, acc.project.ID); err != nil {
			return fmt.Errorf("lock project: %w", err)
		}
		issue, err := lockIssue(ctx, t.q, acc.issue.ID)
		if err != nil {
			return err
		}
		subtasks, err := t.q.ListSubtasks(ctx, issue.ID)
		if err != nil {
			return fmt.Errorf("list subtasks: %w", err)
		}
		if err := t.q.LogUnparentChildren(ctx, db.LogUnparentChildrenParams{ActorID: userID, ParentKey: issue.Key, ParentID: issue.ID}); err != nil {
			return fmt.Errorf("log unparented children: %w", err)
		}
		if err := t.q.UnparentChildren(ctx, issue.ID); err != nil {
			return fmt.Errorf("unparent children: %w", err)
		}
		for _, victim := range append(subtasks, issue) {
			if err := t.q.DeleteIssue(ctx, victim.ID); err != nil {
				return fmt.Errorf("delete issue %s: %w", victim.Key, err)
			}
			entry := activityEntry{
				ProjectID: victim.ProjectID,
				IssueKey:  ptr(victim.Key),
				Action:    ActionIssueDeleted,
				NewValue:  ptr(victim.Summary),
			}
			if err := t.logActivity(ctx, userID, entry); err != nil {
				return err
			}
		}
		t.publish(issue.ProjectID, realtime.IssueDeleted, acc.project.Key, issue.Key, userID)
		return nil
	})
}

// keyShareIssue re-reads an issue with the lock a foreign-key check takes, for writes that
// insert rows referencing it (comments, links, activity). An issue deleted concurrently
// since the access check yields 404 instead of a foreign-key violation.
func keyShareIssue(ctx context.Context, q *db.Queries, id int64) (db.Issue, error) {
	issue, err := q.GetIssueForKeyShare(ctx, id)
	if isNoRows(err) {
		return db.Issue{}, errIssueNotFound
	}
	if err != nil {
		return db.Issue{}, fmt.Errorf("key-share lock issue: %w", err)
	}
	return issue, nil
}

// lockIssue re-reads an issue with a row lock for the rest of the transaction. An issue
// deleted concurrently since the access check yields 404.
func lockIssue(ctx context.Context, q *db.Queries, id int64) (db.Issue, error) {
	issue, err := q.LockIssue(ctx, id)
	if isNoRows(err) {
		return db.Issue{}, errIssueNotFound
	}
	if err != nil {
		return db.Issue{}, fmt.Errorf("lock issue: %w", err)
	}
	return issue, nil
}
