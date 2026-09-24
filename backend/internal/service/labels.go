package service

import (
	"context"
	"fmt"
	"strings"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/realtime"
)

// CreateLabelInput is the body of POST /projects/{key}/labels.
type CreateLabelInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

// UpdateLabelInput is the body of PATCH /projects/{key}/labels/{id}.
type UpdateLabelInput struct {
	Name  httpx.Optional[string] `json:"name,omitzero"`
	Color httpx.Optional[string] `json:"color,omitzero"`
}

var errLabelNotFound = httpx.NotFound("Label not found")

// ListLabels returns the project's labels ordered by name.
func (s *Service) ListLabels(ctx context.Context, userID int64, key string) ([]dto.Label, error) {
	acc, err := s.projectByKey(ctx, s.q, userID, key, RoleViewer)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListLabels(ctx, acc.project.ID)
	if err != nil {
		return nil, fmt.Errorf("list labels: %w", err)
	}
	return toLabels(rows), nil
}

// CreateLabel creates a label (members may create labels). Colours are stored upper-case.
func (s *Service) CreateLabel(ctx context.Context, userID int64, key string, in CreateLabelInput) (dto.Label, error) {
	name := strings.TrimSpace(in.Name)
	color := strings.ToUpper(strings.TrimSpace(in.Color))
	if color == "" {
		color = defaultLabelColor
	}
	var fe httpx.FieldErrors
	checkLength(&fe, "name", name, 1, maxLabelName)
	checkColor(&fe, color)
	if err := fe.Err(); err != nil {
		return dto.Label{}, err
	}
	var out dto.Label
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleMember)
		if err != nil {
			return err
		}
		label, err := t.q.CreateLabel(ctx, db.CreateLabelParams{ProjectID: acc.project.ID, Name: name, Color: color})
		if isUniqueViolation(err) {
			return duplicateLabel(name)
		}
		if err != nil {
			return fmt.Errorf("create label: %w", err)
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		out = toLabel(label)
		return nil
	})
	return out, err
}

// UpdateLabel renames or recolours a label (admin only).
func (s *Service) UpdateLabel(ctx context.Context, userID int64, key string, labelID int64, in UpdateLabelInput) (dto.Label, error) {
	var out dto.Label
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		cur, err := projectLabel(ctx, t.q, acc.project.ID, labelID)
		if err != nil {
			return err
		}
		next := db.UpdateLabelParams{ID: cur.ID, Name: cur.Name, Color: cur.Color}
		var fe httpx.FieldErrors
		if in.Name.Set {
			if in.Name.Null {
				fe.Add("name", "must not be null")
			} else {
				next.Name = strings.TrimSpace(in.Name.Value)
				checkLength(&fe, "name", next.Name, 1, maxLabelName)
			}
		}
		if in.Color.Set {
			if in.Color.Null {
				next.Color = defaultLabelColor
			} else {
				next.Color = strings.ToUpper(strings.TrimSpace(in.Color.Value))
				checkColor(&fe, next.Color)
			}
		}
		if err := fe.Err(); err != nil {
			return err
		}
		if next.Name == cur.Name && next.Color == cur.Color {
			out = toLabel(cur)
			return nil
		}
		label, err := t.q.UpdateLabel(ctx, next)
		if isUniqueViolation(err) {
			return duplicateLabel(next.Name)
		}
		if isNoRows(err) { // deleted since projectLabel read it
			return errLabelNotFound
		}
		if err != nil {
			return fmt.Errorf("update label: %w", err)
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		out = toLabel(label)
		return nil
	})
	return out, err
}

// DeleteLabel deletes a label and removes it from all issues (admin only).
func (s *Service) DeleteLabel(ctx context.Context, userID int64, key string, labelID int64) error {
	return s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		label, err := projectLabel(ctx, t.q, acc.project.ID, labelID)
		if err != nil {
			return err
		}
		if err := t.q.DeleteLabel(ctx, label.ID); err != nil {
			return fmt.Errorf("delete label: %w", err)
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		return nil
	})
}

func projectLabel(ctx context.Context, q *db.Queries, projectID, labelID int64) (db.Label, error) {
	label, err := q.GetLabel(ctx, labelID)
	if isNoRows(err) || (err == nil && label.ProjectID != projectID) {
		return db.Label{}, errLabelNotFound
	}
	if err != nil {
		return db.Label{}, fmt.Errorf("load label: %w", err)
	}
	return label, nil
}

func checkColor(fe *httpx.FieldErrors, color string) {
	if !hexColorPattern.MatchString(color) {
		fe.Add("color", "must be a hex colour like #RRGGBB")
	}
}

func duplicateLabel(name string) error {
	return httpx.Conflict("A label named %q already exists in this project", name)
}
