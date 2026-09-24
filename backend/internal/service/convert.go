package service

import (
	"geneboard/internal/db"
	"geneboard/internal/dto"
)

// Row -> DTO conversions for simple resources. Issues go through hydrateIssues.

func toUser(u db.User) dto.User {
	return dto.User{ID: u.ID, Email: u.Email, Name: u.Name, CreatedAt: dto.TS(u.CreatedAt)}
}

func toUserSummary(u db.User) dto.UserSummary {
	return dto.UserSummary{ID: u.ID, Name: u.Name, Email: u.Email}
}

// userSummaryFrom looks up a nullable user id in a preloaded map.
func userSummaryFrom(id *int64, users map[int64]db.User) *dto.UserSummary {
	if id == nil {
		return nil
	}
	u, ok := users[*id]
	if !ok {
		return nil
	}
	s := toUserSummary(u)
	return &s
}

func toStatus(s db.Status) dto.Status {
	out := dto.Status{ID: s.ID, Name: s.Name, Category: s.Category, Position: int(s.Position)}
	if s.WipLimit != nil {
		w := int(*s.WipLimit)
		out.WipLimit = &w
	}
	return out
}

func toStatuses(rows []db.Status) []dto.Status {
	out := make([]dto.Status, len(rows))
	for i, s := range rows {
		out[i] = toStatus(s)
	}
	return out
}

func toLabel(l db.Label) dto.Label { return dto.Label{ID: l.ID, Name: l.Name, Color: l.Color} }

func toLabels(rows []db.Label) []dto.Label {
	out := make([]dto.Label, len(rows))
	for i, l := range rows {
		out[i] = toLabel(l)
	}
	return out
}

func toSprintRef(s db.Sprint) dto.SprintRef {
	return dto.SprintRef{ID: s.ID, Name: s.Name, State: s.State}
}

// toSprint renders a sprint with its statistics (a zero stats row means no issues).
func toSprint(s db.Sprint, stats db.ListSprintStatsRow) dto.Sprint {
	return dto.Sprint{
		ID:          s.ID,
		ProjectID:   s.ProjectID,
		Name:        s.Name,
		Goal:        s.Goal,
		State:       s.State,
		StartDate:   dto.DatePtr(s.StartDate),
		EndDate:     dto.DatePtr(s.EndDate),
		CompletedAt: dto.TSPtr(s.CompletedAt),
		IssueCount:  stats.IssueCount,
		PointsTotal: stats.PointsTotal,
		PointsDone:  stats.PointsDone,
		CreatedAt:   dto.TS(s.CreatedAt),
		UpdatedAt:   dto.TS(s.UpdatedAt),
	}
}

func toMember(r db.ListMemberViewsRow) dto.Member {
	return dto.Member{
		User:     dto.UserSummary{ID: r.UserID, Name: r.Name, Email: r.Email},
		Role:     r.Role,
		JoinedAt: dto.TS(r.CreatedAt),
	}
}

func toProject(r db.ListProjectViewsRow) dto.Project {
	p := r.Project
	out := dto.Project{
		ID:          p.ID,
		Key:         p.Key,
		Name:        p.Name,
		Description: p.Description,
		Type:        p.Type,
		MyRole:      r.Role,
		IssueCount:  r.IssueCount,
		CreatedAt:   dto.TS(p.CreatedAt),
		UpdatedAt:   dto.TS(p.UpdatedAt),
	}
	if p.LeadID != nil && r.LeadName != nil {
		out.Lead = &dto.UserSummary{ID: *p.LeadID, Name: *r.LeadName, Email: deref(r.LeadEmail)}
	}
	return out
}

func toComment(c db.Comment, authorName, authorEmail *string) dto.Comment {
	out := dto.Comment{
		ID:        c.ID,
		IssueID:   c.IssueID,
		Body:      c.Body,
		CreatedAt: dto.TS(c.CreatedAt),
		UpdatedAt: dto.TS(c.UpdatedAt),
		Edited:    c.UpdatedAt.After(c.CreatedAt),
	}
	if c.AuthorID != nil && authorName != nil {
		out.Author = &dto.UserSummary{ID: *c.AuthorID, Name: *authorName, Email: deref(authorEmail)}
	}
	return out
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

func ptr[T any](v T) *T { return &v }

// equalPtr reports whether two nullable values are equal (both nil, or both set and equal).
func equalPtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
