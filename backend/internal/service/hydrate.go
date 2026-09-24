package service

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strings"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"geneboard/internal/db"
	"geneboard/internal/dto"
)

// hydrateIssues turns issue rows into complete dto.Issue values (status, assignee,
// reporter, parent IssueRef, sprint, labels sorted by name, subtaskCount), preserving the
// order of rows. It runs a constant number of queries (at most six) regardless of
// len(rows), so it is safe for boards, backlogs and search pages.
//
// q may be the pool-bound queries (s.q) or a transaction's (t.q).
func hydrateIssues(ctx context.Context, q *db.Queries, rows []db.Issue) ([]dto.Issue, error) {
	out := make([]dto.Issue, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	ids := make([]int64, len(rows))
	var statusIDs, userIDs, parentIDs, sprintIDs []int64
	for i, r := range rows {
		ids[i] = r.ID
		statusIDs = append(statusIDs, r.StatusID)
		for _, p := range []*int64{r.AssigneeID, r.ReporterID} {
			if p != nil {
				userIDs = append(userIDs, *p)
			}
		}
		if r.ParentID != nil {
			parentIDs = append(parentIDs, *r.ParentID)
		}
		if r.SprintID != nil {
			sprintIDs = append(sprintIDs, *r.SprintID)
		}
	}

	parents, err := issuesByID(ctx, q, parentIDs)
	if err != nil {
		return nil, err
	}
	for _, p := range parents {
		statusIDs = append(statusIDs, p.StatusID)
	}
	statuses, err := statusesByID(ctx, q, statusIDs)
	if err != nil {
		return nil, err
	}
	users, err := usersByID(ctx, q, userIDs)
	if err != nil {
		return nil, err
	}
	sprints, err := sprintsByID(ctx, q, sprintIDs)
	if err != nil {
		return nil, err
	}
	labels, err := labelsByIssue(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	subtaskCounts, err := subtaskCountsByParent(ctx, q, ids)
	if err != nil {
		return nil, err
	}

	for i, r := range rows {
		status, ok := statuses[r.StatusID]
		if !ok {
			return nil, fmt.Errorf("hydrate issue %s: status %d not found", r.Key, r.StatusID)
		}
		issue := dto.Issue{
			ID:           r.ID,
			Key:          r.Key,
			ProjectID:    r.ProjectID,
			ProjectKey:   projectKeyOf(r.Key),
			Type:         r.Type,
			Summary:      r.Summary,
			Description:  r.Description,
			Status:       toStatus(status),
			Priority:     r.Priority,
			Assignee:     userSummaryFrom(r.AssigneeID, users),
			Reporter:     userSummaryFrom(r.ReporterID, users),
			Labels:       labels[r.ID],
			StoryPoints:  r.StoryPoints,
			DueDate:      dto.DatePtr(r.DueDate),
			Rank:         r.Rank,
			SubtaskCount: subtaskCounts[r.ID],
			ResolvedAt:   dto.TSPtr(r.ResolvedAt),
			CreatedAt:    dto.TS(r.CreatedAt),
			UpdatedAt:    dto.TS(r.UpdatedAt),
		}
		if issue.Labels == nil {
			issue.Labels = []dto.Label{}
		}
		if r.ParentID != nil {
			if p, ok := parents[*r.ParentID]; ok {
				ref := toIssueRef(p, statuses[p.StatusID])
				issue.Parent = &ref
			}
		}
		if r.SprintID != nil {
			if sp, ok := sprints[*r.SprintID]; ok {
				ref := toSprintRef(sp)
				issue.Sprint = &ref
			}
		}
		out[i] = issue
	}
	return out, nil
}

// hydrateIssue hydrates a single issue row.
func hydrateIssue(ctx context.Context, q *db.Queries, row db.Issue) (dto.Issue, error) {
	out, err := hydrateIssues(ctx, q, []db.Issue{row})
	if err != nil {
		return dto.Issue{}, err
	}
	return out[0], nil
}

// issueDetail builds the IssueDetail for issue: the issue itself, its direct children
// (ordered by rank) and the links visible to userID (ordered by creation).
func issueDetail(ctx context.Context, q *db.Queries, userID int64, issue db.Issue) (dto.IssueDetail, error) {
	children, err := q.ListChildIssues(ctx, issue.ID)
	if err != nil {
		return dto.IssueDetail{}, fmt.Errorf("list children of %s: %w", issue.Key, err)
	}
	hydrated, err := hydrateIssues(ctx, q, append([]db.Issue{issue}, children...))
	if err != nil {
		return dto.IssueDetail{}, err
	}
	links, err := issueLinks(ctx, q, userID, issue.ID)
	if err != nil {
		return dto.IssueDetail{}, err
	}
	return dto.IssueDetail{Issue: hydrated[0], Children: hydrated[1:], Links: links}, nil
}

// issueRefs converts rows to IssueRefs keyed by issue id (one query for statuses).
func issueRefs(ctx context.Context, q *db.Queries, rows []db.Issue) (map[int64]dto.IssueRef, error) {
	statusIDs := make([]int64, len(rows))
	for i, r := range rows {
		statusIDs[i] = r.StatusID
	}
	statuses, err := statusesByID(ctx, q, statusIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]dto.IssueRef, len(rows))
	for _, r := range rows {
		out[r.ID] = toIssueRef(r, statuses[r.StatusID])
	}
	return out, nil
}

func toIssueRef(i db.Issue, status db.Status) dto.IssueRef {
	return dto.IssueRef{
		ID:       i.ID,
		Key:      i.Key,
		Summary:  i.Summary,
		Type:     i.Type,
		Status:   toStatus(status),
		Priority: i.Priority,
	}
}

// projectKeyOf derives the project key from an issue key ("GB-12" -> "GB"). Both keys are
// immutable, so this never goes stale.
func projectKeyOf(issueKey string) string {
	if i := strings.LastIndexByte(issueKey, '-'); i > 0 {
		return issueKey[:i]
	}
	return issueKey
}

// --- batch loaders (each is a single query; empty input means no query) ---

func issuesByID(ctx context.Context, q *db.Queries, ids []int64) (map[int64]db.Issue, error) {
	out := map[int64]db.Issue{}
	if ids = dedupeIDs(ids); len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListIssuesByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("load issues: %w", err)
	}
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

func statusesByID(ctx context.Context, q *db.Queries, ids []int64) (map[int64]db.Status, error) {
	out := map[int64]db.Status{}
	if ids = dedupeIDs(ids); len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListStatusesByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("load statuses: %w", err)
	}
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

func usersByID(ctx context.Context, q *db.Queries, ids []int64) (map[int64]db.User, error) {
	out := map[int64]db.User{}
	if ids = dedupeIDs(ids); len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListUsersByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("load users: %w", err)
	}
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

func sprintsByID(ctx context.Context, q *db.Queries, ids []int64) (map[int64]db.Sprint, error) {
	out := map[int64]db.Sprint{}
	if ids = dedupeIDs(ids); len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListSprintsByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("load sprints: %w", err)
	}
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

// labelsByIssue returns each issue's labels sorted by name.
func labelsByIssue(ctx context.Context, q *db.Queries, issueIDs []int64) (map[int64][]dto.Label, error) {
	out := map[int64][]dto.Label{}
	if len(issueIDs) == 0 {
		return out, nil
	}
	rows, err := q.ListIssueLabels(ctx, dedupeIDs(issueIDs))
	if err != nil {
		return nil, fmt.Errorf("load issue labels: %w", err)
	}
	for _, r := range rows { // already ordered by issue, lower(name)
		out[r.IssueID] = append(out[r.IssueID], toLabel(r.Label))
	}
	return out, nil
}

func subtaskCountsByParent(ctx context.Context, q *db.Queries, ids []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.CountSubtasks(ctx, dedupeIDs(ids))
	if err != nil {
		return nil, fmt.Errorf("count subtasks: %w", err)
	}
	for _, r := range rows {
		out[r.ParentID] = r.SubtaskCount
	}
	return out, nil
}

// sortedLabelNames returns label names sorted case-insensitively in the Unicode root
// collation, like the label queries ("und-x-icu") and the UI: "Ärger" sorts before "Zeta".
func sortedLabelNames(labels []db.Label) []string {
	sorted := slices.Clone(labels)
	col := collate.New(language.Und) // not safe for concurrent use: one per call
	slices.SortFunc(sorted, func(a, b db.Label) int {
		if c := col.CompareString(strings.ToLower(a.Name), strings.ToLower(b.Name)); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	names := make([]string, len(sorted))
	for i, l := range sorted {
		names[i] = l.Name
	}
	return names
}
