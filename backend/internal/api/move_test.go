package api

import (
	"net/http"
	"slices"
	"testing"

	"geneboard/internal/dto"
)

// rankedKeys returns the project's non-epic issues in rank order via the search API.
func (e *testEnv) rankedKeys(u testUser, projectKey string) []string {
	e.t.Helper()
	page := e.searchIssues(u, "project="+projectKey+"&type=story,task,bug,subtask&sort=rank")
	ranks := make([]string, len(page.Items))
	for i, is := range page.Items {
		ranks[i] = is.Rank
	}
	if !slices.IsSorted(ranks) || len(slices.Compact(slices.Clone(ranks))) != len(ranks) {
		e.t.Fatalf("ranks not strictly increasing: %v", ranks)
	}
	return keysOf(page.Items)
}

func TestMoveReordersByRank(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	var ids = map[string]int64{}
	for i := 1; i <= 5; i++ {
		is := e.newIssue(u, "GB", "task", "Task", nil)
		ids[is.Key] = is.ID
	}
	expect := func(want ...string) {
		t.Helper()
		if got := e.rankedKeys(u, "GB"); !slices.Equal(got, want) {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
	expect("GB-1", "GB-2", "GB-3", "GB-4", "GB-5")

	// Between two neighbours.
	before := e.getIssue(u, "GB-5")
	moved := e.moveIssue(u, "GB-5", map[string]any{"prevIssueId": ids["GB-1"], "nextIssueId": ids["GB-2"]})
	expect("GB-1", "GB-5", "GB-2", "GB-3", "GB-4")
	if !moved.UpdatedAt.Equal(before.UpdatedAt.Time) {
		t.Fatal("rank-only move must not bump updatedAt")
	}
	if n := len(activitiesFor(e.issueActivity(u, "GB-5"), "issue.updated", "")); n != 0 {
		t.Fatalf("rank-only move logged %d rows", n)
	}

	// To the top (only next), to the bottom (only prev).
	e.moveIssue(u, "GB-4", map[string]any{"nextIssueId": ids["GB-1"]})
	expect("GB-4", "GB-1", "GB-5", "GB-2", "GB-3")
	e.moveIssue(u, "GB-4", map[string]any{"prevIssueId": ids["GB-3"], "nextIssueId": nil})
	expect("GB-1", "GB-5", "GB-2", "GB-3", "GB-4")

	// Adjacent neighbours in a filtered list: other issues' ranks between them are respected.
	e.moveIssue(u, "GB-1", map[string]any{"prevIssueId": ids["GB-2"], "nextIssueId": ids["GB-3"]})
	expect("GB-5", "GB-2", "GB-1", "GB-3", "GB-4")

	// Stale neighbours (prev below next): placed right after prev.
	e.moveIssue(u, "GB-5", map[string]any{"prevIssueId": ids["GB-3"], "nextIssueId": ids["GB-2"]})
	expect("GB-2", "GB-1", "GB-3", "GB-5", "GB-4")

	// Many moves into the same gap keep ordering strict.
	for range 30 {
		e.moveIssue(u, "GB-4", map[string]any{"prevIssueId": ids["GB-2"], "nextIssueId": ids["GB-1"]})
		e.moveIssue(u, "GB-3", map[string]any{"prevIssueId": ids["GB-2"], "nextIssueId": ids["GB-4"]})
	}
	expect("GB-2", "GB-3", "GB-4", "GB-1", "GB-5")

	// Neighbour validation (a neighbour that is not an issue of this project is ignored
	// instead: see TestMoveIgnoresDeletedNeighbours).
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/GB-1/move", u.Token, map[string]any{"prevIssueId": ids["GB-1"]}), "prevIssueId")
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/GB-1/move", u.Token, map[string]any{"nextIssueId": ids["GB-1"]}), "nextIssueId")
}

func TestMoveStatusAndSprint(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	p := e.createProject(u, "GB")
	active := e.insertSprint(p.ID, "GB Sprint 1", "active")
	completed := e.insertSprint(p.ID, "GB Sprint 0", "completed")
	epic := e.newIssue(u, "GB", "epic", "Epic", nil)
	story := e.newIssue(u, "GB", "story", "Story", nil)
	sub := e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": story.ID})
	other := e.newIssue(u, "GB", "task", "Other", nil)
	done := e.statusNamed(u, "GB", "Done")
	inProgress := e.statusNamed(u, "GB", "In Progress")

	// Status change via move is logged and resolves the issue.
	moved := e.moveIssue(u, other.Key, map[string]any{"statusId": done.ID})
	if moved.Status.ID != done.ID || moved.ResolvedAt == nil {
		t.Fatalf("moved to done: %+v", moved)
	}
	reopened := e.moveIssue(u, other.Key, map[string]any{"statusId": inProgress.ID})
	if reopened.ResolvedAt != nil {
		t.Fatalf("reopened should clear resolvedAt: %+v", reopened.ResolvedAt)
	}
	hist := activitiesFor(e.issueActivity(u, other.Key), "issue.updated", "status")
	if len(hist) != 2 || deref(hist[0].OldValue) != "Done" || deref(hist[0].NewValue) != "In Progress" {
		t.Fatalf("status history: %+v", hist)
	}

	// Sprint change moves subtasks too; null = backlog.
	inSprint := e.moveIssue(u, story.Key, map[string]any{"sprintId": active, "prevIssueId": other.ID})
	if inSprint.Sprint == nil || inSprint.Sprint.ID != active {
		t.Fatalf("story sprint: %+v", inSprint.Sprint)
	}
	if s := e.getIssue(u, sub.Key).Sprint; s == nil || s.ID != active {
		t.Fatalf("subtask did not follow: %+v", s)
	}
	if h := activitiesFor(e.issueActivity(u, story.Key), "issue.updated", "sprint"); len(h) != 1 || deref(h[0].NewValue) != "GB Sprint 1" {
		t.Fatalf("sprint history: %+v", h)
	}
	// A subtask can only "move" to its parent's sprint.
	e.moveIssue(u, sub.Key, map[string]any{"sprintId": active, "statusId": inProgress.ID})
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/"+sub.Key+"/move", u.Token, map[string]any{"sprintId": nil}), "sprintId")

	back := e.moveIssue(u, story.Key, map[string]any{"sprintId": nil})
	if back.Sprint != nil || e.getIssue(u, sub.Key).Sprint != nil {
		t.Fatal("backlog move should clear sprint of issue and subtasks")
	}

	// Epics cannot be moved; completed sprints are rejected; statusId must not be null.
	expectError(t, e.do(http.MethodPost, "/api/issues/"+epic.Key+"/move", u.Token, map[string]any{"statusId": done.ID}), http.StatusBadRequest, "validation_error")
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/"+story.Key+"/move", u.Token, map[string]any{"sprintId": completed}), "sprintId")
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/"+story.Key+"/move", u.Token, map[string]any{"statusId": nil}), "statusId")
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/"+story.Key+"/move", u.Token, map[string]any{"statusId": 999999}), "statusId")
}

func TestStatusCategoryChangeUpdatesResolvedAt(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	review := e.statusNamed(u, "GB", "In Review")
	issue := e.newIssue(u, "GB", "task", "Under review", map[string]any{"statusId": review.ID})
	if issue.ResolvedAt != nil {
		t.Fatal("not resolved yet")
	}
	path := "/api/projects/GB/statuses/" + itoa(review.ID)

	st := decodeAs[dto.Status](t, e.do(http.MethodPatch, path, u.Token, map[string]any{"category": "done"}), http.StatusOK)
	if st.Category != "done" {
		t.Fatalf("category: %+v", st)
	}
	if got := e.getIssue(u, issue.Key); got.ResolvedAt == nil || got.Status.Category != "done" {
		t.Fatalf("issue should be resolved: %+v", got)
	}
	resolved := e.searchIssues(u, "project=GB&resolved=true")
	expectKeys(t, resolved.Items, issue.Key)

	decodeAs[dto.Status](t, e.do(http.MethodPatch, path, u.Token, map[string]any{"category": "in_progress"}), http.StatusOK)
	if got := e.getIssue(u, issue.Key); got.ResolvedAt != nil {
		t.Fatalf("issue should be unresolved: %+v", got.ResolvedAt)
	}

	// PATCH via issue status also maintains resolvedAt.
	done := e.statusNamed(u, "GB", "Done")
	if got := e.patchIssue(u, issue.Key, map[string]any{"statusId": done.ID}); got.ResolvedAt == nil {
		t.Fatal("PATCH to done should resolve")
	}
	if got := e.patchIssue(u, issue.Key, map[string]any{"statusId": review.ID}); got.ResolvedAt != nil {
		t.Fatal("PATCH out of done should unresolve")
	}
}

func TestStatusCRUD(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")

	qa := decodeAs[dto.Status](t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token, map[string]any{
		"name": " QA ", "category": "in_progress", "wipLimit": 3,
	}), http.StatusCreated)
	if qa.Name != "QA" || qa.Position != 4 || qa.WipLimit == nil || *qa.WipLimit != 3 {
		t.Fatalf("created: %+v", qa)
	}
	expectError(t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token, map[string]any{"name": "qa", "category": "todo"}), http.StatusConflict, "conflict")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token, map[string]any{"name": "X", "category": "blocked"}), "category")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token, map[string]any{"name": "X", "category": "todo", "wipLimit": 0}), "wipLimit")

	path := "/api/projects/GB/statuses/" + itoa(qa.ID)
	renamed := decodeAs[dto.Status](t, e.do(http.MethodPatch, path, u.Token, map[string]any{"name": "Testing", "wipLimit": nil}), http.StatusOK)
	if renamed.Name != "Testing" || renamed.WipLimit != nil || renamed.Category != "in_progress" {
		t.Fatalf("renamed: %+v", renamed)
	}
	expectError(t, e.do(http.MethodPatch, path, u.Token, map[string]any{"name": "done"}), http.StatusConflict, "conflict")
	expectError(t, e.do(http.MethodPatch, "/api/projects/GB/statuses/999999", u.Token, map[string]any{"name": "x"}), http.StatusNotFound, "not_found")

	// Reorder must be a permutation.
	current := e.statuses(u, "GB")
	ids := make([]int64, len(current))
	for i, s := range current {
		ids[i] = s.ID
	}
	expectFieldError(t, e.do(http.MethodPut, "/api/projects/GB/statuses/order", u.Token, map[string]any{"statusIds": ids[:3]}), "statusIds")
	expectFieldError(t, e.do(http.MethodPut, "/api/projects/GB/statuses/order", u.Token, map[string]any{"statusIds": append(slices.Clone(ids[:4]), ids[0])}), "statusIds")
	reversed := slices.Clone(ids)
	slices.Reverse(reversed)
	ordered := decodeAs[[]dto.Status](t, e.do(http.MethodPut, "/api/projects/GB/statuses/order", u.Token, map[string]any{"statusIds": reversed}), http.StatusOK)
	for i, s := range ordered {
		if s.ID != reversed[i] || s.Position != i {
			t.Fatalf("reordered: %+v", ordered)
		}
	}
	// New issues default to the first status by position ("Testing" now).
	if is := e.newIssue(u, "GB", "task", "Default status", nil); is.Status.ID != qa.ID {
		t.Fatalf("default status = %+v", is.Status)
	}
}

func TestStatusDelete(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	todo := e.statusNamed(u, "GB", "To Do")
	review := e.statusNamed(u, "GB", "In Review")
	done := e.statusNamed(u, "GB", "Done")
	issue := e.newIssue(u, "GB", "task", "In review", map[string]any{"statusId": review.ID})
	reviewPath := "/api/projects/GB/statuses/" + itoa(review.ID)

	expectError(t, e.do(http.MethodDelete, reviewPath, u.Token, nil), http.StatusConflict, "conflict")
	expectFieldError(t, e.do(http.MethodDelete, reviewPath+"?moveTo="+itoa(review.ID), u.Token, nil), "moveTo")
	expectFieldError(t, e.do(http.MethodDelete, reviewPath+"?moveTo=999999", u.Token, nil), "moveTo")
	expectError(t, e.do(http.MethodDelete, reviewPath+"?moveTo=abc", u.Token, nil), http.StatusBadRequest, "bad_request")

	expectStatus(t, e.do(http.MethodDelete, reviewPath+"?moveTo="+itoa(done.ID), u.Token, nil), http.StatusNoContent)
	moved := e.getIssue(u, issue.Key)
	if moved.Status.ID != done.ID || moved.ResolvedAt == nil {
		t.Fatalf("issue after status delete: %+v", moved)
	}
	if h := activitiesFor(e.issueActivity(u, issue.Key), "issue.updated", "status"); len(h) != 1 ||
		deref(h[0].OldValue) != "In Review" || deref(h[0].NewValue) != "Done" {
		t.Fatalf("status migration history: %+v", h)
	}
	remaining := e.statuses(u, "GB")
	names := []string{}
	for i, s := range remaining {
		if s.Position != i {
			t.Fatalf("positions not compacted: %+v", remaining)
		}
		names = append(names, s.Name)
	}
	if !slices.Equal(names, []string{"To Do", "In Progress", "Done"}) {
		t.Fatalf("remaining: %v", names)
	}

	// Unused statuses delete without moveTo; the last status cannot be deleted.
	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB/statuses/"+itoa(e.statusNamed(u, "GB", "In Progress").ID), u.Token, nil), http.StatusNoContent)
	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB/statuses/"+itoa(done.ID)+"?moveTo="+itoa(todo.ID), u.Token, nil), http.StatusNoContent)
	expectError(t, e.do(http.MethodDelete, "/api/projects/GB/statuses/"+itoa(todo.ID), u.Token, nil), http.StatusConflict, "conflict")
	if got := e.getIssue(u, issue.Key); got.Status.ID != todo.ID || got.ResolvedAt != nil {
		t.Fatalf("issue after second migration: %+v", got)
	}
}

func TestLabelCRUD(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	member := e.createUser("Member")
	e.createProject(admin, "GB")
	e.addMember(admin, "GB", member, "member")

	l := decodeAs[dto.Label](t, e.do(http.MethodPost, "/api/projects/GB/labels", member.Token, map[string]any{"name": "Backend", "color": "#00ff00"}), http.StatusCreated)
	if l.Color != "#00FF00" || l.Name != "Backend" {
		t.Fatalf("label: %+v", l)
	}
	expectError(t, e.do(http.MethodPost, "/api/projects/GB/labels", member.Token, map[string]any{"name": "backend"}), http.StatusConflict, "conflict")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/labels", member.Token, map[string]any{"name": "x", "color": "green"}), "color")
	path := "/api/projects/GB/labels/" + itoa(l.ID)
	expectError(t, e.do(http.MethodPatch, path, member.Token, map[string]any{"name": "x"}), http.StatusForbidden, "forbidden")
	expectError(t, e.do(http.MethodDelete, path, member.Token, nil), http.StatusForbidden, "forbidden")
	updated := decodeAs[dto.Label](t, e.do(http.MethodPatch, path, admin.Token, map[string]any{"name": "API", "color": "#123abc"}), http.StatusOK)
	if updated.Name != "API" || updated.Color != "#123ABC" {
		t.Fatalf("updated: %+v", updated)
	}
	e.createLabel(admin, "GB", "zeta")
	e.createLabel(admin, "GB", "alpha")
	list := decodeAs[[]dto.Label](t, e.do(http.MethodGet, "/api/projects/GB/labels", member.Token, nil), http.StatusOK)
	if len(list) != 3 || list[0].Name != "alpha" || list[1].Name != "API" || list[2].Name != "zeta" {
		t.Fatalf("labels by name: %+v", list)
	}
	expectStatus(t, e.do(http.MethodDelete, path, admin.Token, nil), http.StatusNoContent)
	expectError(t, e.do(http.MethodDelete, path, admin.Token, nil), http.StatusNotFound, "not_found")
}
