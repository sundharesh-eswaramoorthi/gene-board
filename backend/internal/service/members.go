package service

import (
	"context"
	"fmt"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
	"geneboard/internal/realtime"
)

// AddMemberInput is the body of POST /projects/{key}/members.
type AddMemberInput struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

// UpdateMemberInput is the body of PATCH /projects/{key}/members/{userId}.
type UpdateMemberInput struct {
	Role string `json:"role"`
}

var (
	errMemberNotFound = httpx.NotFound("Member not found")
	errLastAdmin      = httpx.Conflict("A project must keep at least one admin")
)

// ListMembers returns the project's members ordered by name.
func (s *Service) ListMembers(ctx context.Context, userID int64, key string) ([]dto.Member, error) {
	acc, err := s.projectByKey(ctx, s.q, userID, key, RoleViewer)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListMemberViews(ctx, db.ListMemberViewsParams{ProjectID: acc.project.ID})
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	out := make([]dto.Member, len(rows))
	for i, r := range rows {
		out[i] = toMember(r)
	}
	return out, nil
}

// AddMember adds an existing user (by e-mail) to the project (admin only). The role
// defaults to member.
func (s *Service) AddMember(ctx context.Context, userID int64, key string, in AddMemberInput) (dto.Member, error) {
	email := normalizeEmail(in.Email)
	role := RoleMember
	var fe httpx.FieldErrors
	checkEmail(&fe, "email", email)
	if in.Role != "" {
		var ok bool
		if role, ok = parseRole(in.Role); !ok {
			fe.Add("role", oneOf(projectRoles))
		}
	}
	if err := fe.Err(); err != nil {
		return dto.Member{}, err
	}

	var out dto.Member
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		// Membership changes are serialised on the project lock (see lockMember).
		if acc, err = s.lockProjectAs(ctx, t, userID, acc.project.ID, RoleAdmin); err != nil {
			return err
		}
		user, err := t.q.GetUserByEmail(ctx, email)
		if isNoRows(err) {
			return httpx.NotFound("No user with email %s", email)
		}
		if err != nil {
			return fmt.Errorf("load user: %w", err)
		}
		if _, err := t.q.AddMember(ctx, db.AddMemberParams{ProjectID: acc.project.ID, UserID: user.ID, Role: string(role)}); err != nil {
			if isUniqueViolation(err) {
				return httpx.Conflict("%s is already a member of this project", user.Name)
			}
			return fmt.Errorf("add member: %w", err)
		}
		entry := projectEntry(acc.project.ID, ActionMemberAdded, fmt.Sprintf("%s (%s)", user.Name, role))
		if err := t.logActivity(ctx, userID, entry); err != nil {
			return err
		}
		t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		out, err = memberView(ctx, t.q, acc.project.ID, user.ID)
		return err
	})
	return out, err
}

// UpdateMember changes a member's role (admin only); the last admin cannot be demoted.
func (s *Service) UpdateMember(ctx context.Context, userID int64, key string, memberID int64, in UpdateMemberInput) (dto.Member, error) {
	role, ok := parseRole(in.Role)
	if !ok {
		return dto.Member{}, httpx.Validation("role", oneOf(projectRoles))
	}
	var out dto.Member
	err := s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, RoleAdmin)
		if err != nil {
			return err
		}
		acc, member, err := s.lockMember(ctx, t, userID, acc.project.ID, RoleAdmin, memberID)
		if err != nil {
			return err
		}
		if Role(member.Role) != role {
			if Role(member.Role) == RoleAdmin {
				if err := ensureAnotherAdmin(ctx, t.q, acc.project.ID); err != nil {
					return err
				}
			}
			if err := t.q.UpdateMemberRole(ctx, db.UpdateMemberRoleParams{ProjectID: acc.project.ID, UserID: memberID, Role: string(role)}); err != nil {
				return fmt.Errorf("update member role: %w", err)
			}
			t.publish(acc.project.ID, realtime.ProjectChanged, acc.project.Key, "", userID)
		}
		out, err = memberView(ctx, t.q, acc.project.ID, memberID)
		return err
	})
	return out, err
}

// RemoveMember removes a member (admin, or the member themself to leave). The last admin
// cannot be removed. The removed user's assigned issues in the project become unassigned
// (logged as assignee changes) and they stop being the project lead.
func (s *Service) RemoveMember(ctx context.Context, userID int64, key string, memberID int64) error {
	minRole := RoleAdmin
	if memberID == userID {
		minRole = RoleViewer // leaving the project
	}
	return s.inTx(ctx, func(t *txn) error {
		acc, err := s.projectByKey(ctx, t.q, userID, key, minRole)
		if err != nil {
			return err
		}
		acc, member, err := s.lockMember(ctx, t, userID, acc.project.ID, minRole, memberID)
		if err != nil {
			return err
		}
		if Role(member.Role) == RoleAdmin {
			if err := ensureAnotherAdmin(ctx, t.q, acc.project.ID); err != nil {
				return err
			}
		}
		user, err := t.q.GetUserByID(ctx, memberID)
		if err != nil {
			return fmt.Errorf("load member user: %w", err)
		}
		pid := acc.project.ID
		if err := t.q.LogUnassignMemberIssues(ctx, db.LogUnassignMemberIssuesParams{ActorID: userID, ProjectID: pid, UserID: memberID}); err != nil {
			return fmt.Errorf("log unassignments: %w", err)
		}
		if err := t.q.UnassignMemberIssues(ctx, db.UnassignMemberIssuesParams{ProjectID: pid, UserID: memberID}); err != nil {
			return fmt.Errorf("unassign issues: %w", err)
		}
		if err := t.q.ClearProjectLead(ctx, db.ClearProjectLeadParams{ProjectID: pid, UserID: memberID}); err != nil {
			return fmt.Errorf("clear project lead: %w", err)
		}
		if err := t.q.DeleteMember(ctx, db.DeleteMemberParams{ProjectID: pid, UserID: memberID}); err != nil {
			return fmt.Errorf("delete member: %w", err)
		}
		if err := t.logActivity(ctx, userID, projectEntry(pid, ActionMemberRemoved, user.Name)); err != nil {
			return err
		}
		t.publish(pid, realtime.ProjectChanged, acc.project.Key, "", userID)
		return nil
	})
}

// lockMember serialises membership changes of a project (so two admins cannot demote each
// other concurrently, and an admin being demoted or removed cannot act on the role they
// had): it takes the project lock, checks the caller's role (min) again under it and loads
// the target membership.
func (s *Service) lockMember(ctx context.Context, t *txn, userID, projectID int64, min Role, memberID int64) (projectAccess, db.ProjectMember, error) {
	acc, err := s.lockProjectAs(ctx, t, userID, projectID, min)
	if err != nil {
		return projectAccess{}, db.ProjectMember{}, err
	}
	member, err := t.q.GetMember(ctx, db.GetMemberParams{ProjectID: projectID, UserID: memberID})
	if isNoRows(err) {
		return projectAccess{}, db.ProjectMember{}, errMemberNotFound
	}
	if err != nil {
		return projectAccess{}, db.ProjectMember{}, fmt.Errorf("load member: %w", err)
	}
	return acc, member, nil
}

func ensureAnotherAdmin(ctx context.Context, q *db.Queries, projectID int64) error {
	admins, err := q.CountProjectAdmins(ctx, projectID)
	if err != nil {
		return fmt.Errorf("count admins: %w", err)
	}
	if admins <= 1 {
		return errLastAdmin
	}
	return nil
}

func memberView(ctx context.Context, q *db.Queries, projectID, userID int64) (dto.Member, error) {
	rows, err := q.ListMemberViews(ctx, db.ListMemberViewsParams{ProjectID: projectID, UserID: &userID})
	if err != nil {
		return dto.Member{}, fmt.Errorf("load member: %w", err)
	}
	if len(rows) == 0 {
		return dto.Member{}, errMemberNotFound
	}
	return toMember(rows[0]), nil
}
