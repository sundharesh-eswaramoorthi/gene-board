package api

import (
	"net/http"
	"testing"
)

func TestSearchFiltersSortAndPagination(t *testing.T) {
	e := newTestEnv(t)
	me := e.createUser("Me")
	dev := e.createUser("Dev")
	stranger := e.createUser("Stranger")
	p := e.createProject(me, "GB")
	e.createProject(me, "OPS")
	e.createProject(stranger, "SEC")
	e.addMember(me, "GB", dev, "member")
	active := e.insertSprint(p.ID, "GB Sprint 1", "active")
	planned := e.insertSprint(p.ID, "GB Sprint 2", "planned")
	ui := e.createLabel(me, "GB", "ui")
	api := e.createLabel(me, "GB", "api")
	done := e.statusNamed(me, "GB", "Done")
	inProgress := e.statusNamed(me, "GB", "In Progress")

	// Fixture (keys in creation order):
	//   GB-1 epic  "Billing epic"
	//   GB-2 story "Invoice PDF export"   epic GB-1, assignee me, high, active sprint, label ui, due 2026-10-10
	//   GB-3 bug   "Crash on 100% zoom"   assignee dev, highest, Done, active sprint, description "Stack trace attached"
	//   GB-4 task  "Refactor API client"  low, labels api+ui, In Progress, planned sprint, due 2026-09-30
	//   GB-5 task  "Write docs"           epic GB-1, lowest, reported by dev
	//   OPS-1 task "Rotate certificates"  assignee me
	//   SEC-1 task "Invisible"            (project the caller cannot see)
	epic := e.newIssue(me, "GB", "epic", "Billing epic", nil)
	e.newIssue(me, "GB", "story", "Invoice PDF export", map[string]any{
		"parentId": epic.ID, "assigneeId": me.ID, "priority": "high", "sprintId": active,
		"labelIds": []int64{ui.ID}, "dueDate": "2026-10-10",
	})
	e.newIssue(me, "GB", "bug", "Crash on 100% zoom", map[string]any{
		"assigneeId": dev.ID, "priority": "highest", "statusId": done.ID,
		"description": "Stack trace attached", "sprintId": active,
	})
	e.newIssue(me, "GB", "task", "Refactor API client", map[string]any{
		"priority": "low", "labelIds": []int64{api.ID, ui.ID}, "statusId": inProgress.ID,
		"sprintId": planned, "dueDate": "2026-09-30",
	})
	e.newIssue(dev, "GB", "task", "Write docs", map[string]any{"parentId": epic.ID, "priority": "lowest"})
	e.newIssue(me, "OPS", "task", "Rotate certificates", map[string]any{"assigneeId": me.ID})
	e.newIssue(stranger, "SEC", "task", "Invisible", nil)

	cases := []struct {
		query string
		want  []string
	}{
		{"", []string{"GB-1", "GB-2", "GB-3", "GB-4", "GB-5", "OPS-1"}},
		{"project=gb", []string{"GB-1", "GB-2", "GB-3", "GB-4", "GB-5"}},
		{"q=gb-3", []string{"GB-3"}},
		{"q=invoice", []string{"GB-2"}},
		{"q=STACK%20TRACE", []string{"GB-3"}},
		{"q=100%25", []string{"GB-3"}},
		{"q=invisible", []string{}},
		{"type=bug,task", []string{"GB-3", "GB-4", "GB-5", "OPS-1"}},
		{"type=task&type=epic", []string{"GB-1", "GB-4", "GB-5", "OPS-1"}},
		{"project=GB&statusId=" + itoa(done.ID) + "," + itoa(inProgress.ID), []string{"GB-3", "GB-4"}},
		{"statusCategory=done", []string{"GB-3"}},
		{"statusCategory=todo,in_progress&project=GB", []string{"GB-1", "GB-2", "GB-4", "GB-5"}},
		{"priority=highest,high", []string{"GB-2", "GB-3"}},
		{"labelId=" + itoa(ui.ID), []string{"GB-2", "GB-4"}},
		{"labelId=" + itoa(api.ID), []string{"GB-4"}},
		{"assigneeId=me", []string{"GB-2", "OPS-1"}},
		{"assigneeId=none&project=GB", []string{"GB-1", "GB-4", "GB-5"}},
		{"assigneeId=me," + itoa(dev.ID), []string{"GB-2", "GB-3", "OPS-1"}},
		{"assigneeId=none,me&project=GB", []string{"GB-1", "GB-2", "GB-4", "GB-5"}},
		{"reporterId=" + itoa(dev.ID), []string{"GB-5"}},
		{"reporterId=me&project=OPS", []string{"OPS-1"}},
		{"sprintId=active", []string{"GB-2", "GB-3"}},
		{"sprintId=" + itoa(planned), []string{"GB-4"}},
		{"sprintId=none&project=GB", []string{"GB-1", "GB-5"}},
		{"parentId=" + itoa(epic.ID), []string{"GB-2", "GB-5"}},
		{"epicId=" + itoa(epic.ID), []string{"GB-2", "GB-5"}},
		{"resolved=true", []string{"GB-3"}},
		{"resolved=false&project=GB", []string{"GB-1", "GB-2", "GB-4", "GB-5"}},
		{"sort=priority&project=GB", []string{"GB-3", "GB-2", "GB-1", "GB-4", "GB-5"}},
		{"sort=priority&order=desc&project=GB", []string{"GB-5", "GB-4", "GB-1", "GB-2", "GB-3"}},
		{"sort=created", []string{"OPS-1", "GB-5", "GB-4", "GB-3", "GB-2", "GB-1"}},
		{"sort=key", []string{"GB-1", "GB-2", "GB-3", "GB-4", "GB-5", "OPS-1"}},
		{"sort=key&order=desc", []string{"OPS-1", "GB-5", "GB-4", "GB-3", "GB-2", "GB-1"}},
		{"sort=dueDate&project=GB", []string{"GB-4", "GB-2", "GB-1", "GB-3", "GB-5"}},
		{"sort=dueDate&order=desc&project=GB", []string{"GB-2", "GB-4", "GB-5", "GB-3", "GB-1"}},
		{"sort=summary&project=GB", []string{"GB-1", "GB-3", "GB-2", "GB-4", "GB-5"}},
		{"type=&priority=", []string{"GB-1", "GB-2", "GB-3", "GB-4", "GB-5", "OPS-1"}},
	}
	for _, c := range cases {
		t.Run(c.query, func(t *testing.T) {
			page := e.searchIssues(me, c.query)
			expectKeys(t, page.Items, c.want...)
			if page.Total != int64(len(c.want)) {
				t.Fatalf("total = %d, want %d", page.Total, len(c.want))
			}
		})
	}

	// Pagination: total counts all matches; items are the requested window.
	page := e.searchIssues(me, "sort=key&limit=2&offset=2")
	expectKeys(t, page.Items, "GB-3", "GB-4")
	if page.Total != 6 || page.Limit != 2 || page.Offset != 2 {
		t.Fatalf("page meta: total=%d limit=%d offset=%d", page.Total, page.Limit, page.Offset)
	}
	beyond := e.searchIssues(me, "limit=2&offset=50")
	if len(beyond.Items) != 0 || beyond.Total != 6 || beyond.Items == nil {
		t.Fatalf("beyond: %+v", beyond)
	}
	if big := e.searchIssues(me, "limit=5000"); big.Limit != 200 {
		t.Fatalf("limit should be capped at 200, got %d", big.Limit)
	}
	if def := e.searchIssues(me, ""); def.Limit != 50 || def.Offset != 0 {
		t.Fatalf("default page: %d/%d", def.Limit, def.Offset)
	}

	// Hydrated items.
	story := e.searchIssues(me, "q=GB-2").Items[0]
	if story.Parent == nil || story.Parent.Key != "GB-1" || story.Sprint == nil || story.Sprint.ID != active ||
		len(story.Labels) != 1 || story.Assignee == nil || story.Reporter == nil || story.ProjectKey != "GB" {
		t.Fatalf("hydration: %+v", story)
	}

	// Invalid parameters.
	for _, q := range []string{"type=feature", "statusId=abc", "statusCategory=open", "priority=urgent", "labelId=-1",
		"assigneeId=someone", "reporterId=none", "sprintId=next", "parentId=x", "resolved=maybe", "sort=random",
		"order=up", "limit=0", "limit=x", "offset=-1"} {
		expectError(t, e.do(http.MethodGet, "/api/issues?"+q, me.Token, nil), http.StatusBadRequest, "bad_request")
	}
	expectError(t, e.do(http.MethodGet, "/api/issues?project=SEC", me.Token, nil), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodGet, "/api/issues?project=NOPE", me.Token, nil), http.StatusNotFound, "not_found")
}
