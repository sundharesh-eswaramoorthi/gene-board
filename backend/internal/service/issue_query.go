package service

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"geneboard/internal/db"
	"geneboard/internal/dto"
	"geneboard/internal/httpx"
)

// This file holds the only hand-written SQL of the service layer: the filterable issue
// search behind GET /issues. User input only ever reaches the database as bind
// parameters ($n); identifiers and ORDER BY expressions come from fixed whitelists.

// Issue search pagination limits.
const (
	DefaultIssueSearchLimit = 50
	MaxIssueSearchLimit     = 200
)

// IssueSearch is a parsed GET /issues query (SPEC §5).
type IssueSearch struct {
	ProjectKey       string   // project; empty = all of the caller's projects
	Text             string   // q: exact key or summary/description substring
	Types            []string // type
	StatusIDs        []int64  // statusId
	StatusCategories []string // statusCategory
	Priorities       []string // priority
	LabelIDs         []int64  // labelId (issue has any)
	AssigneeIDs      []int64  // assigneeId ids
	AssigneeMe       bool     // assigneeId contains "me"
	AssigneeNone     bool     // assigneeId contains "none"
	ReporterIDs      []int64  // reporterId ids
	ReporterMe       bool     // reporterId contains "me"
	SprintIDs        []int64  // sprintId ids
	SprintNone       bool     // sprintId contains "none" (backlog)
	SprintActive     bool     // sprintId contains "active"
	ParentID         *int64   // parentId / epicId
	Resolved         *bool    // resolved
	Sort             string   // sort key (see issueSorts)
	Descending       bool     // order
	Limit            int
	Offset           int
}

// issueSort describes a whitelisted sort: ORDER BY expressions and the default direction.
type issueSort struct {
	exprs       []string
	defaultDesc bool
	nullsLast   bool
}

var issueSorts = map[string]issueSort{
	// Ranks are only comparable within a project, so rank order groups by project first
	// (identical to plain rank order for single-project searches).
	"rank":    {exprs: []string{"p.key", "i.rank"}},
	"created": {exprs: []string{"i.created_at"}, defaultDesc: true},
	"updated": {exprs: []string{"i.updated_at"}, defaultDesc: true},
	// ascending priority = highest first
	"priority": {exprs: []string{"CASE i.priority WHEN 'highest' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END"}},
	"key":      {exprs: []string{"p.key", "i.number"}},
	"dueDate":  {exprs: []string{"i.due_date"}, nullsLast: true},
	"summary":  {exprs: []string{`lower(i.summary) COLLATE "und-x-icu"`}}, // like names (queries/labels.sql)
}

// ParseIssueSearch parses GET /issues query parameters. Empty values are ignored; lists
// are comma-separated and may be repeated. Invalid values yield 400 bad_request.
func ParseIssueSearch(v url.Values) (IssueSearch, error) {
	s := IssueSearch{Sort: "rank", Limit: DefaultIssueSearchLimit}
	var err error
	bad := func(name string) error { return httpx.BadRequest("Invalid value for query parameter %q", name) }

	s.ProjectKey = normalizeProjectKey(v.Get("project"))
	s.Text = strings.TrimSpace(v.Get("q"))

	for _, t := range listParam(v, "type") {
		if t = strings.ToLower(t); !slices.Contains(issueTypes, t) {
			return s, bad("type")
		}
		s.Types = append(s.Types, t)
	}
	if s.StatusIDs, err = idListParam(v, "statusId"); err != nil {
		return s, err
	}
	for _, c := range listParam(v, "statusCategory") {
		if !slices.Contains(statusCategories, c) {
			return s, bad("statusCategory")
		}
		s.StatusCategories = append(s.StatusCategories, c)
	}
	for _, p := range listParam(v, "priority") {
		if p = strings.ToLower(p); !slices.Contains(priorities, p) {
			return s, bad("priority")
		}
		s.Priorities = append(s.Priorities, p)
	}
	if s.LabelIDs, err = idListParam(v, "labelId"); err != nil {
		return s, err
	}
	for _, a := range listParam(v, "assigneeId") {
		switch strings.ToLower(a) {
		case "me":
			s.AssigneeMe = true
		case "none":
			s.AssigneeNone = true
		default:
			id, ok := parseID(a)
			if !ok {
				return s, bad("assigneeId")
			}
			s.AssigneeIDs = append(s.AssigneeIDs, id)
		}
	}
	for _, r := range listParam(v, "reporterId") {
		if strings.EqualFold(r, "me") {
			s.ReporterMe = true
			continue
		}
		id, ok := parseID(r)
		if !ok {
			return s, bad("reporterId")
		}
		s.ReporterIDs = append(s.ReporterIDs, id)
	}
	for _, sp := range listParam(v, "sprintId") {
		switch strings.ToLower(sp) {
		case "none":
			s.SprintNone = true
		case "active":
			s.SprintActive = true
		default:
			id, ok := parseID(sp)
			if !ok {
				return s, bad("sprintId")
			}
			s.SprintIDs = append(s.SprintIDs, id)
		}
	}
	for _, name := range []string{"parentId", "epicId"} {
		if raw := strings.TrimSpace(v.Get(name)); raw != "" {
			id, ok := parseID(raw)
			if !ok {
				return s, bad(name)
			}
			s.ParentID = &id
		}
	}
	if raw := strings.TrimSpace(v.Get("resolved")); raw != "" {
		switch strings.ToLower(raw) {
		case "true":
			s.Resolved = ptr(true)
		case "false":
			s.Resolved = ptr(false)
		default:
			return s, bad("resolved")
		}
	}
	if raw := strings.TrimSpace(v.Get("sort")); raw != "" {
		if _, ok := issueSorts[raw]; !ok {
			return s, bad("sort")
		}
		s.Sort = raw
	}
	s.Descending = issueSorts[s.Sort].defaultDesc
	if raw := strings.TrimSpace(v.Get("order")); raw != "" {
		switch strings.ToLower(raw) {
		case "asc":
			s.Descending = false
		case "desc":
			s.Descending = true
		default:
			return s, bad("order")
		}
	}
	if raw := strings.TrimSpace(v.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return s, bad("limit")
		}
		s.Limit = min(n, MaxIssueSearchLimit)
	}
	if raw := strings.TrimSpace(v.Get("offset")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			return s, bad("offset")
		}
		s.Offset = n
	}
	return s, nil
}

// SearchIssues runs an issue search restricted to projects the user belongs to.
func (s *Service) SearchIssues(ctx context.Context, userID int64, search IssueSearch) (dto.Page[dto.Issue], error) {
	page := dto.Page[dto.Issue]{Items: []dto.Issue{}, Limit: search.Limit, Offset: search.Offset}
	if page.Limit <= 0 {
		page.Limit = DefaultIssueSearchLimit
	}
	sortSpec, ok := issueSorts[search.Sort]
	if !ok {
		return page, httpx.BadRequest("Invalid value for query parameter %q", "sort")
	}

	var b sqlBuilder
	if search.ProjectKey != "" {
		acc, err := s.projectByKey(ctx, s.q, userID, search.ProjectKey, RoleViewer)
		if err != nil {
			return page, err
		}
		b.where("i.project_id = " + b.arg(acc.project.ID))
	} else {
		b.where("i.project_id IN (SELECT pm.project_id FROM project_members pm WHERE pm.user_id = " + b.arg(userID) + ")")
	}
	if search.Text != "" {
		pattern := "%" + escapeLike(search.Text) + "%"
		p := b.arg(pattern)
		b.where("(i.key = " + b.arg(strings.ToUpper(search.Text)) + " OR i.summary ILIKE " + p + " OR i.description ILIKE " + p + ")")
	}
	if len(search.Types) > 0 {
		b.where("i.type = ANY(" + b.arg(search.Types) + ")")
	}
	if len(search.StatusIDs) > 0 {
		b.where("i.status_id = ANY(" + b.arg(search.StatusIDs) + ")")
	}
	if len(search.StatusCategories) > 0 {
		b.where("s.category = ANY(" + b.arg(search.StatusCategories) + ")")
	}
	if len(search.Priorities) > 0 {
		b.where("i.priority = ANY(" + b.arg(search.Priorities) + ")")
	}
	if len(search.LabelIDs) > 0 {
		b.where("EXISTS (SELECT 1 FROM issue_labels il WHERE il.issue_id = i.id AND il.label_id = ANY(" + b.arg(search.LabelIDs) + "))")
	}
	assignees := slices.Clone(search.AssigneeIDs)
	if search.AssigneeMe {
		assignees = append(assignees, userID)
	}
	var alts []string
	if len(assignees) > 0 {
		alts = append(alts, "i.assignee_id = ANY("+b.arg(assignees)+")")
	}
	if search.AssigneeNone {
		alts = append(alts, "i.assignee_id IS NULL")
	}
	b.whereAny(alts)

	reporters := slices.Clone(search.ReporterIDs)
	if search.ReporterMe {
		reporters = append(reporters, userID)
	}
	if len(reporters) > 0 {
		b.where("i.reporter_id = ANY(" + b.arg(reporters) + ")")
	}

	alts = nil
	if len(search.SprintIDs) > 0 {
		alts = append(alts, "i.sprint_id = ANY("+b.arg(search.SprintIDs)+")")
	}
	if search.SprintNone {
		alts = append(alts, "i.sprint_id IS NULL")
	}
	if search.SprintActive {
		alts = append(alts, "i.sprint_id IN (SELECT sp.id FROM sprints sp WHERE sp.project_id = i.project_id AND sp.state = 'active')")
	}
	b.whereAny(alts)

	if search.ParentID != nil {
		b.where("i.parent_id = " + b.arg(*search.ParentID))
	}
	if search.Resolved != nil {
		if *search.Resolved {
			b.where("i.resolved_at IS NOT NULL")
		} else {
			b.where("i.resolved_at IS NULL")
		}
	}

	from := " FROM issues i JOIN projects p ON p.id = i.project_id JOIN statuses s ON s.id = i.status_id WHERE " + b.conditions()

	if err := s.pool.QueryRow(ctx, "SELECT count(*)"+from, b.args...).Scan(&page.Total); err != nil {
		return page, fmt.Errorf("count issues: %w", err)
	}
	if page.Total == 0 || search.Offset >= int(page.Total) {
		return page, nil
	}

	dir := " ASC"
	if search.Descending {
		dir = " DESC"
	}
	order := make([]string, 0, len(sortSpec.exprs)+1)
	for _, e := range sortSpec.exprs {
		term := e + dir
		if sortSpec.nullsLast {
			term += " NULLS LAST"
		}
		order = append(order, term)
	}
	order = append(order, "i.id"+dir)
	query := "SELECT i.*" + from + " ORDER BY " + strings.Join(order, ", ") +
		" LIMIT " + b.arg(page.Limit) + " OFFSET " + b.arg(search.Offset)

	rows, err := s.pool.Query(ctx, query, b.args...)
	if err != nil {
		return page, fmt.Errorf("search issues: %w", err)
	}
	issues, err := pgx.CollectRows(rows, pgx.RowToStructByName[db.Issue])
	if err != nil {
		return page, fmt.Errorf("scan issues: %w", err)
	}
	if page.Items, err = hydrateIssues(ctx, s.q, issues); err != nil {
		return page, err
	}
	return page, nil
}

// sqlBuilder accumulates WHERE conditions and their positional arguments.
type sqlBuilder struct {
	conds []string
	args  []any
}

// arg registers a bind parameter and returns its placeholder ($n).
func (b *sqlBuilder) arg(v any) string {
	b.args = append(b.args, v)
	return "$" + strconv.Itoa(len(b.args))
}

func (b *sqlBuilder) where(cond string) { b.conds = append(b.conds, cond) }

// whereAny adds (c1 OR c2 ...) when conds is non-empty.
func (b *sqlBuilder) whereAny(conds []string) {
	if len(conds) > 0 {
		b.where("(" + strings.Join(conds, " OR ") + ")")
	}
}

func (b *sqlBuilder) conditions() string {
	if len(b.conds) == 0 {
		return "TRUE"
	}
	return strings.Join(b.conds, " AND ")
}

// listParam returns the non-empty, trimmed items of a comma-separated (and possibly
// repeated) query parameter.
func listParam(v url.Values, name string) []string {
	var out []string
	for _, raw := range v[name] {
		for item := range strings.SplitSeq(raw, ",") {
			if item = strings.TrimSpace(item); item != "" {
				out = append(out, item)
			}
		}
	}
	return out
}

func idListParam(v url.Values, name string) ([]int64, error) {
	var out []int64
	for _, item := range listParam(v, name) {
		id, ok := parseID(item)
		if !ok {
			return nil, httpx.BadRequest("Invalid value for query parameter %q", name)
		}
		out = append(out, id)
	}
	return out, nil
}

// parseID parses a positive int64 id.
func parseID(s string) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return id, err == nil && id > 0
}
