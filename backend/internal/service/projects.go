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

// CreateProjectInput is the body of POST /projects.
type CreateProjectInput struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        string `json:"type"`
}

// UpdateProjectInput is the body of PATCH /projects/{key}.
type UpdateProjectInput struct {
	Name        httpx.Optional[string] `json:"name,omitzero"`
	Description httpx.Optional[string] `json:"description,omitzero"`
	Type        httpx.Optional[string] `json:"type,omitzero"`
	LeadID      httpx.Optional[int64]  `json:"leadId,omitzero"`
}

// defaultStatuses are created for every new project (SPEC §2 Statuses).
var defaultStatuses = []struct{ name, category string }{
	{"To Do", dto.CategoryTodo},
	{"In Progress", dto.CategoryInProgress},
	{"In Review", dto.CategoryInProgress},
	{"Done", dto.CategoryDone},
}

// ListProjects returns the projects the user is a member of, ordered by name.
func (s *Service) ListProjects(ctx context.Context, userID int64) ([]dto.Project, error) {
	rows, err := s.q.ListProjectViews(ctx, db.ListProjectViewsParams{UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	out := make([]dto.Project, len(rows))
	for i, r := range rows {
		out[i] = toProject(r)
	}
	return out, nil
}

// GetProject returns one project the user is a member of.
func (s *Service) GetProject(ctx context.Context, userID int64, key string) (dto.Project, error) {
	acc, err := s.projectByKey(ctx, s.q, userID, key, RoleViewer)
	if err != nil {
		return dto.Project{}, err
	}
	return projectView(ctx, s.q, userID, acc.project.ID)
}

// projectView renders the Project DTO (lead, myRole, issueCount) for a member.
func projectView(ctx context.Context, q *db.Queries, userID, projectID int64) (dto.Project, error) {
	rows, err := q.ListProjectViews(ctx, db.ListProjectViewsParams{UserID: userID, ProjectID: &projectID})
	if err != nil {
		return dto.Project{}, fmt.Errorf("load project view: %w", err)
	}
	if len(rows) == 0 {
		return dto.Project{}, errProjectNotFound
	}
	return toProject(rows[0]), nil
}

// CreateProject creates a project with the default workflow; the creator becomes its
// admin and lead.
func (s *Service) CreateProject(ctx context.Context, userID int64, in CreateProjectInput) (dto.Project, error) {
	key := normalizeProjectKey(in.Key)
	name := cleanName(in.Name)
	description := strings.TrimSpace(in.Description)
	projectType := strings.ToLower(strings.TrimSpace(in.Type))
	if projectType == "" {
		projectType = dto.ProjectTypeScrum
	}
	var fe httpx.FieldErrors
	switch {
	case key == "":
		fe.Add("key", "is required")
	case !projectKeyPattern.MatchString(key):
		fe.Add("key", "must be 2-10 letters or digits, starting with a letter")
	}
	checkLength(&fe, "name", name, 1, maxProjectName)
	checkLength(&fe, "description", description, 0, maxProjectDesc)
	checkEnum(&fe, "type", projectType, projectTypes)
	if err := fe.Err(); err != nil {
		return dto.Project{}, err
	}

	var out dto.Project
	err := s.inTx(ctx, func(t *txn) error {
		project, err := t.q.CreateProject(ctx, db.CreateProjectParams{
			Key: key, Name: name, Description: description, Type: projectType, LeadID: &userID,
		})
		if isUniqueViolation(err) {
			return httpx.Conflict("Project key %s is already in use", key)
		}
		if err != nil {
			return fmt.Errorf("create project: %w", err)
		}
		if _, err := t.q.AddMember(ctx, db.AddMemberParams{ProjectID: project.ID, UserID: userID, Role: string(RoleAdmin)}); err != nil {
			return fmt.Errorf("add creator as admin: %w", err)
		}
		for i, st := range defaultStatuses {
			if _, err := t.q.CreateStatus(ctx, db.CreateStatusParams{
				ProjectID: project.ID, Name: st.name, Category: st.category, Position: int32(i),
			}); err != nil {
				return fmt.Errorf("create default status: %w", err)
			}
		}
		if err := t.logActivity(ctx, userID, projectEntry(project.ID, ActionProjectCreated, project.Name)); err != nil {
			return err
		}
		t.publish(project.ID, realtime.ProjectChanged, project.Key, "", userID)
		out, err = projectView(ctx, t.q, userID, project.ID)
		return err
	})
	return out, err
}

// UpdateProject edits a project's details (admin only). The lead must be a member.
//
// The project row is locked and re-read before the new values are computed: UpdateProject
// writes every column, so working from a stale read would undo a concurrent change — e.g.
// put back a lead that RemoveMember (which also takes the project lock) just cleared.
func (s *Service) UpdateProject(ctx context.Context, userID int64, key string, in UpdateProjectInput) (dto.Project, error) {
	var out dto.Project
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		if acc, err = s.lockProjectAs(ctx, t, userID, acc.project.ID, RoleAdmin); err != nil {
			return err
		}
		p := acc.project
		next := db.UpdateProjectParams{ID: p.ID, Name: p.Name, Description: p.Description, Type: p.Type, LeadID: p.LeadID}

		var fe httpx.FieldErrors
		if in.Name.Set {
			if in.Name.Null {
				fe.Add("name", "must not be null")
			} else {
				next.Name = cleanName(in.Name.Value)
				checkLength(&fe, "name", next.Name, 1, maxProjectName)
			}
		}
		if in.Description.Set {
			next.Description = strings.TrimSpace(in.Description.Value) // null clears
			checkLength(&fe, "description", next.Description, 0, maxProjectDesc)
		}
		if in.Type.Set {
			if in.Type.Null {
				fe.Add("type", "must not be null")
			} else {
				next.Type = strings.ToLower(strings.TrimSpace(in.Type.Value))
				checkEnum(&fe, "type", next.Type, projectTypes)
			}
		}
		if err := fe.Err(); err != nil {
			return err
		}
		if in.LeadID.Set {
			next.LeadID = in.LeadID.Ptr()
			if next.LeadID != nil && !equalPtr(next.LeadID, p.LeadID) {
				if err := requireMember(ctx, t.q, p.ID, *next.LeadID, "leadId"); err != nil {
					return err
				}
			}
		}

		changed := next.Name != p.Name || next.Description != p.Description || next.Type != p.Type || !equalPtr(next.LeadID, p.LeadID)
		if changed {
			if _, err := t.q.UpdateProject(ctx, next); err != nil {
				return fmt.Errorf("update project: %w", err)
			}
			t.publish(p.ID, realtime.ProjectChanged, p.Key, "", userID)
		}
		out, err = projectView(ctx, t.q, userID, p.ID)
		return err
	})
	return out, err
}

// DeleteProject deletes a project and everything in it (admin only). Issues of other
// projects that were linked to its issues lose those links, so their projects are notified.
func (s *Service) DeleteProject(ctx context.Context, userID int64, key string) error {
	return s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		if acc, err = s.lockProjectAs(ctx, t, userID, acc.project.ID, RoleAdmin); err != nil {
			return err
		}
		unlinked, err := t.q.ListCrossProjectLinkedIssues(ctx, db.ListCrossProjectLinkedIssuesParams{ProjectID: acc.project.ID})
		if err != nil {
			return fmt.Errorf("list cross-project links: %w", err)
		}
		if err := t.q.DeleteProject(ctx, acc.project.ID); err != nil {
			return fmt.Errorf("delete project: %w", err)
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		publishUnlinked(t, unlinked, userID)
		return nil
	})
}

// lockProjectAs takes the project row lock (LockProject) and re-reads the project and the
// caller's role under it, checking min again. Writes check access before they wait for the
// lock, and a change holding it may meanwhile have demoted or removed the caller, switched
// the project's type or deleted the project (404): callers must work from the returned row.
func (s *Service) lockProjectAs(ctx context.Context, t *txn, userID, projectID int64, min Role) (projectAccess, error) {
	if err := t.q.LockProject(ctx, projectID); err != nil {
		return projectAccess{}, fmt.Errorf("lock project: %w", err)
	}
	return s.projectByID(ctx, t.q, userID, projectID, min)
}

// requireMember returns a validation error on field unless userID belongs to the project.
func requireMember(ctx context.Context, q *db.Queries, projectID, userID int64, field string) error {
	ok, err := q.IsProjectMember(ctx, db.IsProjectMemberParams{ProjectID: projectID, UserID: userID})
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return httpx.Validation(field, "must be a member of this project")
	}
	return nil
}
