package service

import (
	"context"
	"fmt"
	"strings"

	"geneboard/internal/db"
	"geneboard/internal/httpx"
)

// Role is a project role. Roles are ordered viewer < member < admin.
type Role string

// Project roles.
const (
	RoleViewer Role = "viewer"
	RoleMember Role = "member"
	RoleAdmin  Role = "admin"
)

func (r Role) level() int {
	switch r {
	case RoleViewer:
		return 1
	case RoleMember:
		return 2
	case RoleAdmin:
		return 3
	default:
		return 0
	}
}

// AtLeast reports whether r grants everything min grants.
func (r Role) AtLeast(min Role) bool { return r.level() >= min.level() && r.level() > 0 }

func parseRole(s string) (Role, bool) {
	r := Role(strings.ToLower(strings.TrimSpace(s)))
	return r, r.level() > 0
}

// requireRole returns a 403 when have is below min.
func requireRole(have, min Role) error {
	if have.AtLeast(min) {
		return nil
	}
	if min == RoleAdmin {
		return httpx.Forbidden("Only project admins can do this")
	}
	return httpx.Forbidden("Viewers cannot make changes in this project")
}

// projectAccess is a project together with the caller's role in it.
type projectAccess struct {
	project db.Project
	role    Role
}

// normalizeProjectKey upper-cases and trims a project key from a URL or body.
func normalizeProjectKey(key string) string { return strings.ToUpper(strings.TrimSpace(key)) }

// projectByKey loads a project the user is a member of and checks the minimum role.
// Non-members (and unknown keys) get 404; insufficient roles get 403.
func (s *Service) projectByKey(ctx context.Context, q *db.Queries, userID int64, key string, min Role) (projectAccess, error) {
	row, err := q.GetProjectAccessByKey(ctx, db.GetProjectAccessByKeyParams{Key: normalizeProjectKey(key), UserID: userID})
	if isNoRows(err) {
		return projectAccess{}, errProjectNotFound
	}
	if err != nil {
		return projectAccess{}, fmt.Errorf("load project %q: %w", key, err)
	}
	acc := projectAccess{project: row.Project, role: Role(row.Role)}
	return acc, requireRole(acc.role, min)
}

// projectByID is projectByKey for a project id (e.g. resolved from a sprint).
func (s *Service) projectByID(ctx context.Context, q *db.Queries, userID, projectID int64, min Role) (projectAccess, error) {
	row, err := q.GetProjectAccessByID(ctx, db.GetProjectAccessByIDParams{ProjectID: projectID, UserID: userID})
	if isNoRows(err) {
		return projectAccess{}, errProjectNotFound
	}
	if err != nil {
		return projectAccess{}, fmt.Errorf("load project %d: %w", projectID, err)
	}
	acc := projectAccess{project: row.Project, role: Role(row.Role)}
	return acc, requireRole(acc.role, min)
}

// issueAccess is an issue, its project and the caller's role in that project.
type issueAccess struct {
	issue   db.Issue
	project db.Project
	role    Role
}

// normalizeIssueKey upper-cases and trims an issue key (lookups are case-insensitive).
func normalizeIssueKey(key string) string { return strings.ToUpper(strings.TrimSpace(key)) }

// issueByKey loads an issue in a project the user belongs to and checks the minimum role.
func (s *Service) issueByKey(ctx context.Context, q *db.Queries, userID int64, key string, min Role) (issueAccess, error) {
	row, err := q.GetIssueAccessByKey(ctx, db.GetIssueAccessByKeyParams{Key: normalizeIssueKey(key), UserID: userID})
	if isNoRows(err) {
		return issueAccess{}, errIssueNotFound
	}
	if err != nil {
		return issueAccess{}, fmt.Errorf("load issue %q: %w", key, err)
	}
	acc := issueAccess{issue: row.Issue, project: row.Project, role: Role(row.Role)}
	return acc, requireRole(acc.role, min)
}

// issueByID is issueByKey for an issue id.
func (s *Service) issueByID(ctx context.Context, q *db.Queries, userID, issueID int64, min Role) (issueAccess, error) {
	row, err := q.GetIssueAccessByID(ctx, db.GetIssueAccessByIDParams{IssueID: issueID, UserID: userID})
	if isNoRows(err) {
		return issueAccess{}, errIssueNotFound
	}
	if err != nil {
		return issueAccess{}, fmt.Errorf("load issue %d: %w", issueID, err)
	}
	acc := issueAccess{issue: row.Issue, project: row.Project, role: Role(row.Role)}
	return acc, requireRole(acc.role, min)
}
