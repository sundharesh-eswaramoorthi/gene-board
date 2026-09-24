package service

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/realtime"
)

// CreateStatusInput is the body of POST /projects/{key}/statuses.
type CreateStatusInput struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	WipLimit *int   `json:"wipLimit"`
}

// UpdateStatusInput is the body of PATCH /projects/{key}/statuses/{id}.
type UpdateStatusInput struct {
	Name     httpx.Optional[string] `json:"name,omitzero"`
	Category httpx.Optional[string] `json:"category,omitzero"`
	WipLimit httpx.Optional[int]    `json:"wipLimit,omitzero"`
}

// ReorderStatusesInput is the body of PUT /projects/{key}/statuses/order.
type ReorderStatusesInput struct {
	StatusIDs []int64 `json:"statusIds"`
}

var errStatusNotFound = httpx.NotFound("Status not found")

// ListStatuses returns the project's statuses ordered by position.
func (s *Service) ListStatuses(ctx context.Context, userID int64, key string) ([]dto.Status, error) {
	acc, err := s.projectByKey(ctx, s.q, userID, key, RoleViewer)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListStatuses(ctx, acc.project.ID)
	if err != nil {
		return nil, fmt.Errorf("list statuses: %w", err)
	}
	return toStatuses(rows), nil
}

// CreateStatus appends a status to the workflow (admin only).
func (s *Service) CreateStatus(ctx context.Context, userID int64, key string, in CreateStatusInput) (dto.Status, error) {
	name := cleanName(in.Name)
	category := strings.TrimSpace(in.Category)
	var fe httpx.FieldErrors
	checkLength(&fe, "name", name, 1, maxStatusName)
	checkEnum(&fe, "category", category, statusCategories)
	checkWipLimit(&fe, in.WipLimit)
	if err := fe.Err(); err != nil {
		return dto.Status{}, err
	}

	var out dto.Status
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		if acc, err = s.lockProjectAs(ctx, t, userID, acc.project.ID, RoleAdmin); err != nil {
			return err
		}
		pos, err := t.q.NextStatusPosition(ctx, acc.project.ID)
		if err != nil {
			return fmt.Errorf("next status position: %w", err)
		}
		st, err := t.q.CreateStatus(ctx, db.CreateStatusParams{
			ProjectID: acc.project.ID, Name: name, Category: category, Position: pos, WipLimit: toInt32Ptr(in.WipLimit),
		})
		if isUniqueViolation(err) {
			return duplicateStatus(name)
		}
		if err != nil {
			return fmt.Errorf("create status: %w", err)
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		out = toStatus(st)
		return nil
	})
	return out, err
}

// UpdateStatus renames a status, changes its category or WIP limit (admin only). A
// category change into or out of "done" updates resolvedAt of the status's issues.
//
// The project and status rows are locked first. Issue writes take the project lock and
// key-share-lock the status they move an issue into, so an issue write either commits
// before the category change (whose resolvedAt sync then includes the issue) or waits and
// derives resolvedAt from the new category. The status lock also turns a concurrent
// delete into a 404.
func (s *Service) UpdateStatus(ctx context.Context, userID int64, key string, statusID int64, in UpdateStatusInput) (dto.Status, error) {
	var out dto.Status
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		if acc, err = s.lockProjectAs(ctx, t, userID, acc.project.ID, RoleAdmin); err != nil {
			return err
		}
		cur, err := t.q.LockStatus(ctx, statusID)
		if cur, err = statusInProject(cur, err, acc.project.ID); err != nil {
			return err
		}
		next := db.UpdateStatusParams{ID: cur.ID, Name: cur.Name, Category: cur.Category, WipLimit: cur.WipLimit}
		var fe httpx.FieldErrors
		if in.Name.Set {
			if in.Name.Null {
				fe.Add("name", "must not be null")
			} else {
				next.Name = cleanName(in.Name.Value)
				checkLength(&fe, "name", next.Name, 1, maxStatusName)
			}
		}
		if in.Category.Set {
			if in.Category.Null {
				fe.Add("category", "must not be null")
			} else {
				next.Category = strings.TrimSpace(in.Category.Value)
				checkEnum(&fe, "category", next.Category, statusCategories)
			}
		}
		if in.WipLimit.Set {
			checkWipLimit(&fe, in.WipLimit.Ptr())
			next.WipLimit = toInt32Ptr(in.WipLimit.Ptr())
		}
		if err := fe.Err(); err != nil {
			return err
		}
		if next.Name == cur.Name && next.Category == cur.Category && equalPtr(next.WipLimit, cur.WipLimit) {
			out = toStatus(cur)
			return nil
		}
		updated, err := t.q.UpdateStatus(ctx, next)
		if isUniqueViolation(err) {
			return duplicateStatus(next.Name)
		}
		if err != nil {
			return fmt.Errorf("update status: %w", err)
		}
		wasDone, isDone := cur.Category == dto.CategoryDone, updated.Category == dto.CategoryDone
		if wasDone != isDone {
			if err := t.q.SyncResolvedAtForStatus(ctx, db.SyncResolvedAtForStatusParams{Done: isDone, StatusID: cur.ID}); err != nil {
				return fmt.Errorf("sync resolvedAt: %w", err)
			}
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		out = toStatus(updated)
		return nil
	})
	return out, err
}

// ReorderStatuses sets the column order; statusIds must be a permutation of all the
// project's status ids (admin only).
func (s *Service) ReorderStatuses(ctx context.Context, userID int64, key string, in ReorderStatusesInput) ([]dto.Status, error) {
	var out []dto.Status
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		if acc, err = s.lockProjectAs(ctx, t, userID, acc.project.ID, RoleAdmin); err != nil {
			return err
		}
		current, err := t.q.ListStatuses(ctx, acc.project.ID)
		if err != nil {
			return fmt.Errorf("list statuses: %w", err)
		}
		have := make([]int64, len(current))
		for i, st := range current {
			have[i] = st.ID
		}
		want := slices.Clone(in.StatusIDs)
		slices.Sort(have)
		slices.Sort(want)
		if !slices.Equal(have, want) {
			return httpx.Validation("statusIds", "must list every status of the project exactly once")
		}
		if err := t.q.ReorderStatuses(ctx, db.ReorderStatusesParams{ProjectID: acc.project.ID, Ids: in.StatusIDs}); err != nil {
			return fmt.Errorf("reorder statuses: %w", err)
		}
		rows, err := t.q.ListStatuses(ctx, acc.project.ID)
		if err != nil {
			return fmt.Errorf("list statuses: %w", err)
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		out = toStatuses(rows)
		return nil
	})
	return out, err
}

// DeleteStatus deletes a status (admin only). The last status cannot be deleted; if issues
// use the status, moveTo (another status of the project) is required and those issues are
// moved there (logged as status changes). Positions are re-compacted afterwards.
func (s *Service) DeleteStatus(ctx context.Context, userID int64, key string, statusID int64, moveTo *int64) error {
	return s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		if acc, err = s.lockProjectAs(ctx, t, userID, acc.project.ID, RoleAdmin); err != nil {
			return err
		}
		pid := acc.project.ID
		// Lock the status before counting its issues: an issue write moving an issue into it
		// either commits first (and is then moved to moveTo below) or waits and finds it gone.
		st, err := t.q.LockStatus(ctx, statusID)
		if st, err = statusInProject(st, err, pid); err != nil {
			return err
		}
		all, err := t.q.ListStatuses(ctx, pid)
		if err != nil {
			return fmt.Errorf("list statuses: %w", err)
		}
		if len(all) <= 1 {
			return httpx.Conflict("A project must keep at least one status")
		}
		inUse, err := t.q.CountStatusIssues(ctx, st.ID)
		if err != nil {
			return fmt.Errorf("count status issues: %w", err)
		}
		if inUse > 0 {
			if moveTo == nil {
				return httpx.Conflict("%d issue(s) use this status; choose a status to move them to (moveTo)", inUse)
			}
			if *moveTo == st.ID {
				return httpx.Validation("moveTo", "must be a different status")
			}
			target, err := projectStatus(ctx, t.q, pid, *moveTo)
			if err != nil {
				if httpx.IsCode(err, httpx.CodeNotFound) {
					return httpx.Validation("moveTo", "must be another status of this project")
				}
				return err
			}
			if err := t.q.LogStatusMigration(ctx, db.LogStatusMigrationParams{
				ActorID: userID, OldName: st.Name, NewName: target.Name, FromStatusID: st.ID,
			}); err != nil {
				return fmt.Errorf("log status migration: %w", err)
			}
			if err := t.q.MoveIssuesToStatus(ctx, db.MoveIssuesToStatusParams{
				ToStatusID: target.ID, ToDone: target.Category == dto.CategoryDone, FromStatusID: st.ID,
			}); err != nil {
				return fmt.Errorf("move issues: %w", err)
			}
		}
		if err := t.q.DeleteStatus(ctx, st.ID); err != nil {
			return fmt.Errorf("delete status: %w", err)
		}
		if err := t.q.CompactStatusPositions(ctx, pid); err != nil {
			return fmt.Errorf("compact positions: %w", err)
		}
		t.publish(pid, realtime.ProjectChanged, acc.project.Key, "", userID)
		return nil
	})
}

// projectStatus loads a status and checks it belongs to the project (404 otherwise).
func projectStatus(ctx context.Context, q *db.Queries, projectID, statusID int64) (db.Status, error) {
	st, err := q.GetStatus(ctx, statusID)
	return statusInProject(st, err, projectID)
}

// statusInProject checks the result of loading a status: it must exist and belong to the
// project (404 otherwise).
func statusInProject(st db.Status, err error, projectID int64) (db.Status, error) {
	if isNoRows(err) || (err == nil && st.ProjectID != projectID) {
		return db.Status{}, errStatusNotFound
	}
	if err != nil {
		return db.Status{}, fmt.Errorf("load status: %w", err)
	}
	return st, nil
}

func checkWipLimit(fe *httpx.FieldErrors, limit *int) {
	if limit != nil && (*limit < 1 || *limit > maxWipLimit) {
		fe.Add("wipLimit", fmt.Sprintf("must be between 1 and %d", maxWipLimit))
	}
}

func toInt32Ptr(v *int) *int32 {
	if v == nil {
		return nil
	}
	n := int32(*v)
	return &n
}

func duplicateStatus(name string) error {
	return httpx.Conflict("A status named %q already exists in this project", name)
}
