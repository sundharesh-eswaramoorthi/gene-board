package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"geneboard/internal/dto"
)

func TestCreateIssueEveryTypeAndDefaults(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	p := e.createProject(u, "GB")
	todo := e.statusNamed(u, "GB", "To Do")

	epic := e.newIssue(u, "GB", "epic", "  Payments  ", nil)
	if epic.Key != "GB-1" || epic.Type != "epic" || epic.Summary != "Payments" || epic.Status.ID != todo.ID ||
		epic.Priority != "medium" || epic.Reporter == nil || epic.Reporter.ID != u.ID || epic.Assignee != nil ||
		epic.ProjectID != p.ID || epic.ProjectKey != "GB" || epic.Rank == "" || epic.ResolvedAt != nil ||
		epic.Parent != nil || epic.Sprint != nil || len(epic.Labels) != 0 || len(epic.Children) != 0 || len(epic.Links) != 0 {
		t.Fatalf("epic: %+v", epic)
	}
	story := e.newIssue(u, "GB", "story", "Checkout", map[string]any{
		"parentId": epic.ID, "priority": "high", "storyPoints": 5, "dueDate": "2026-10-01", "description": "As a user…",
		"assigneeId": u.ID,
	})
	if story.Parent == nil || story.Parent.Key != "GB-1" || story.Parent.Type != "epic" || story.Parent.Status.ID != todo.ID ||
		story.StoryPoints == nil || *story.StoryPoints != 5 || story.DueDate == nil || story.DueDate.String() != "2026-10-01" ||
		story.Priority != "high" || story.Assignee == nil || story.Description != "As a user…" {
		t.Fatalf("story: %+v", story)
	}
	task := e.newIssue(u, "GB", "task", "Refactor", map[string]any{"reporterId": nil})
	if task.Reporter != nil {
		t.Fatalf("explicit null reporter: %+v", task.Reporter)
	}
	bug := e.newIssue(u, "GB", "bug", "Crash", map[string]any{"parentId": epic.ID})
	sub := e.newIssue(u, "GB", "subtask", "Write tests", map[string]any{"parentId": story.ID})
	if sub.Parent == nil || sub.Parent.ID != story.ID {
		t.Fatalf("subtask: %+v", sub)
	}

	// Parents list their children by rank, standard issues count subtasks.
	epicDetail := e.getIssue(u, "gb-1") // case-insensitive
	expectKeys(t, epicDetail.Children, story.Key, bug.Key)
	if epicDetail.SubtaskCount != 0 {
		t.Fatalf("epic subtaskCount = %d", epicDetail.SubtaskCount)
	}
	storyDetail := e.getIssue(u, story.Key)
	expectKeys(t, storyDetail.Children, sub.Key)
	if storyDetail.SubtaskCount != 1 || storyDetail.Children[0].SubtaskCount != 0 {
		t.Fatalf("subtaskCount: %d", storyDetail.SubtaskCount)
	}
	if len(e.getIssue(u, sub.Key).Children) != 0 || len(e.getIssue(u, task.Key).Children) != 0 {
		t.Fatal("expected no children")
	}

	// Ranks: every new issue goes last.
	if !(epic.Rank < story.Rank && story.Rank < task.Rank && task.Rank < bug.Rank && bug.Rank < sub.Rank) {
		t.Fatalf("ranks not increasing: %s %s %s %s %s", epic.Rank, story.Rank, task.Rank, bug.Rank, sub.Rank)
	}

	// Creating directly in a done status resolves the issue.
	done := e.statusNamed(u, "GB", "Done")
	resolved := e.newIssue(u, "GB", "task", "Already done", map[string]any{"statusId": done.ID})
	if resolved.ResolvedAt == nil || resolved.Status.Category != "done" {
		t.Fatalf("resolvedAt: %+v", resolved)
	}

	act := e.issueActivity(u, story.Key)
	if len(act) != 1 || act[0].Action != "issue.created" || deref(act[0].NewValue) != "Checkout" ||
		deref(act[0].IssueKey) != story.Key || act[0].Actor == nil || act[0].Actor.ID != u.ID || act[0].ProjectKey != "GB" {
		t.Fatalf("issue.created activity: %+v", act)
	}
}

func TestCreateIssueHierarchyViolations(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	outsider := e.createUser("Outsider")
	p := e.createProject(u, "GB")
	e.createProject(u, "OPS")
	epic := e.newIssue(u, "GB", "epic", "Epic", nil)
	story := e.newIssue(u, "GB", "story", "Story", nil)
	sub := e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": story.ID})
	otherEpic := e.newIssue(u, "OPS", "epic", "Other epic", nil)
	otherLabel := e.createLabel(u, "OPS", "ops-only")
	otherStatus := e.statuses(u, "OPS")[0]
	completed := e.insertSprint(p.ID, "Old sprint", "completed")

	create := func(body map[string]any) *testResponse {
		return e.do(http.MethodPost, "/api/projects/GB/issues", u.Token, body)
	}
	cases := []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"missing type", map[string]any{"summary": "x"}, "type"},
		{"bad type", map[string]any{"type": "feature", "summary": "x"}, "type"},
		{"empty summary", map[string]any{"type": "task", "summary": "   "}, "summary"},
		{"long summary", map[string]any{"type": "task", "summary": strings.Repeat("s", 256)}, "summary"},
		{"bad priority", map[string]any{"type": "task", "summary": "x", "priority": "urgent"}, "priority"},
		{"negative points", map[string]any{"type": "task", "summary": "x", "storyPoints": -1}, "storyPoints"},
		{"epic with parent", map[string]any{"type": "epic", "summary": "x", "parentId": epic.ID}, "parentId"},
		{"story under story", map[string]any{"type": "story", "summary": "x", "parentId": story.ID}, "parentId"},
		{"story under subtask", map[string]any{"type": "story", "summary": "x", "parentId": sub.ID}, "parentId"},
		{"story under foreign epic", map[string]any{"type": "story", "summary": "x", "parentId": otherEpic.ID}, "parentId"},
		{"story under missing issue", map[string]any{"type": "story", "summary": "x", "parentId": 999999}, "parentId"},
		{"subtask without parent", map[string]any{"type": "subtask", "summary": "x"}, "parentId"},
		{"subtask under epic", map[string]any{"type": "subtask", "summary": "x", "parentId": epic.ID}, "parentId"},
		{"subtask under subtask", map[string]any{"type": "subtask", "summary": "x", "parentId": sub.ID}, "parentId"},
		{"epic in sprint", map[string]any{"type": "epic", "summary": "x", "sprintId": completed}, "sprintId"},
		{"completed sprint", map[string]any{"type": "task", "summary": "x", "sprintId": completed}, "sprintId"},
		{"missing sprint", map[string]any{"type": "task", "summary": "x", "sprintId": 424242}, "sprintId"},
		{"foreign label", map[string]any{"type": "task", "summary": "x", "labelIds": []int64{otherLabel.ID}}, "labelIds"},
		{"foreign status", map[string]any{"type": "task", "summary": "x", "statusId": otherStatus.ID}, "statusId"},
		{"non-member assignee", map[string]any{"type": "task", "summary": "x", "assigneeId": outsider.ID}, "assigneeId"},
		{"non-member reporter", map[string]any{"type": "task", "summary": "x", "reporterId": outsider.ID}, "reporterId"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { expectFieldError(t, create(c.body), c.field) })
	}
	expectError(t, create(map[string]any{"type": "task", "summary": "x", "dueDate": "2026-13-01"}), http.StatusBadRequest, "bad_request")

	// Nothing above consumed an issue number.
	next := e.newIssue(u, "GB", "task", "Next", nil)
	if next.Key != "GB-4" {
		t.Fatalf("key after failed creates = %s, want GB-4", next.Key)
	}
}

func TestSubtaskSprintInheritance(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	p := e.createProject(u, "GB")
	active := e.insertSprint(p.ID, "GB Sprint 1", "active")
	planned := e.insertSprint(p.ID, "GB Sprint 2", "planned")

	story := e.newIssue(u, "GB", "story", "Story", map[string]any{"sprintId": active})
	if story.Sprint == nil || story.Sprint.ID != active || story.Sprint.Name != "GB Sprint 1" || story.Sprint.State != "active" {
		t.Fatalf("story sprint: %+v", story.Sprint)
	}
	sub := e.newIssue(u, "GB", "subtask", "Inherits", map[string]any{"parentId": story.ID})
	if sub.Sprint == nil || sub.Sprint.ID != active {
		t.Fatalf("subtask did not inherit sprint: %+v", sub.Sprint)
	}
	e.newIssue(u, "GB", "subtask", "Explicit same", map[string]any{"parentId": story.ID, "sprintId": active})
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/issues", u.Token, map[string]any{
		"type": "subtask", "summary": "x", "parentId": story.ID, "sprintId": planned,
	}), "sprintId")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+sub.Key, u.Token, map[string]any{"sprintId": planned}), "sprintId")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+sub.Key, u.Token, map[string]any{"sprintId": nil}), "sprintId")

	// Changing the parent's sprint moves its subtasks (and logs it for them).
	e.patchIssue(u, story.Key, map[string]any{"sprintId": planned})
	after := e.getIssue(u, sub.Key)
	if after.Sprint == nil || after.Sprint.ID != planned {
		t.Fatalf("subtask sprint after parent change: %+v", after.Sprint)
	}
	hist := activitiesFor(e.issueActivity(u, sub.Key), "issue.updated", "sprint")
	if len(hist) != 1 || deref(hist[0].OldValue) != "GB Sprint 1" || deref(hist[0].NewValue) != "GB Sprint 2" {
		t.Fatalf("subtask sprint history: %+v", hist)
	}
	e.patchIssue(u, story.Key, map[string]any{"sprintId": nil})
	if s := e.getIssue(u, sub.Key).Sprint; s != nil {
		t.Fatalf("subtask should follow parent to backlog: %+v", s)
	}

	// Re-parenting a subtask makes it follow the new parent's sprint.
	other := e.newIssue(u, "GB", "task", "Other", map[string]any{"sprintId": active})
	moved := e.patchIssue(u, sub.Key, map[string]any{"parentId": other.ID})
	if moved.Sprint == nil || moved.Sprint.ID != active || moved.Parent.ID != other.ID {
		t.Fatalf("re-parented subtask: parent=%+v sprint=%+v", moved.Parent, moved.Sprint)
	}
}

func TestIssueKeysArePerProject(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	e.createProject(u, "OPS")
	var got []string
	for _, key := range []string{"GB", "GB", "OPS", "GB", "OPS"} {
		got = append(got, e.newIssue(u, key, "task", "t", nil).Key)
	}
	want := []string{"GB-1", "GB-2", "OPS-1", "GB-3", "OPS-2"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("keys = %v, want %v", got, want)
		}
	}
	// Deleted numbers are never reused.
	expectStatus(t, e.do(http.MethodDelete, "/api/issues/GB-3", u.Token, nil), http.StatusNoContent)
	if k := e.newIssue(u, "GB", "task", "t", nil).Key; k != "GB-4" {
		t.Fatalf("key after delete = %s", k)
	}
	p := decodeAs[dto.Project](t, e.do(http.MethodGet, "/api/projects/GB", u.Token, nil), http.StatusOK)
	if p.IssueCount != 3 {
		t.Fatalf("issueCount = %d", p.IssueCount)
	}
	expectError(t, e.do(http.MethodGet, "/api/issues/GB-99", u.Token, nil), http.StatusNotFound, "not_found")
}

func TestPatchAbsentVersusNull(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	orig := e.newIssue(u, "GB", "task", "Original", map[string]any{
		"assigneeId": u.ID, "storyPoints": 3, "dueDate": "2026-12-24", "description": "Details", "priority": "high",
	})

	// Empty body: nothing changes, no activity, updatedAt unchanged.
	same := e.patchIssue(u, orig.Key, map[string]any{})
	if !same.UpdatedAt.Equal(orig.UpdatedAt.Time) || same.Summary != "Original" {
		t.Fatalf("no-op patch changed the issue: %+v", same)
	}
	// Re-sending current values is also a no-op.
	same = e.patchIssue(u, orig.Key, map[string]any{"summary": "Original", "storyPoints": 3, "dueDate": "2026-12-24", "assigneeId": u.ID, "labelIds": []int64{}})
	if !same.UpdatedAt.Equal(orig.UpdatedAt.Time) {
		t.Fatal("identical values must not bump updatedAt")
	}
	if n := len(activitiesFor(e.issueActivity(u, orig.Key), "issue.updated", "")); n != 0 {
		t.Fatalf("no-op patches logged %d rows", n)
	}

	// Absent fields stay; only summary changes.
	time.Sleep(5 * time.Millisecond) // make the updatedAt bump observable at ms precision
	changed := e.patchIssue(u, orig.Key, map[string]any{"summary": "Renamed"})
	if changed.Summary != "Renamed" || changed.Assignee == nil || changed.StoryPoints == nil || changed.DueDate == nil ||
		changed.Description != "Details" || changed.Priority != "high" || !changed.UpdatedAt.After(orig.UpdatedAt.Time) {
		t.Fatalf("partial patch: %+v", changed)
	}

	// Explicit nulls clear nullable fields.
	cleared := e.patchIssue(u, orig.Key, map[string]any{"assigneeId": nil, "storyPoints": nil, "dueDate": nil, "description": nil})
	if cleared.Assignee != nil || cleared.StoryPoints != nil || cleared.DueDate != nil || cleared.Description != "" || cleared.Summary != "Renamed" {
		t.Fatalf("null patch: %+v", cleared)
	}

	// Null is rejected for required fields.
	for _, f := range []string{"summary", "type", "priority", "statusId"} {
		expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+orig.Key, u.Token, map[string]any{f: nil}), f)
	}
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+orig.Key, u.Token, map[string]any{"summary": ""}), "summary")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+orig.Key, u.Token, map[string]any{"storyPoints": 1001}), "storyPoints")
}

func TestPatchWritesOneActivityRowPerField(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	dev := e.createUser("Dev")
	p := e.createProject(u, "GB")
	e.addMember(u, "GB", dev, "member")
	sprint := e.insertSprint(p.ID, "GB Sprint 1", "active")
	epic := e.newIssue(u, "GB", "epic", "Epic", nil)
	backend := e.createLabel(u, "GB", "backend")
	api := e.createLabel(u, "GB", "api")
	inProgress := e.statusNamed(u, "GB", "In Progress")
	issue := e.newIssue(u, "GB", "story", "Before", nil)

	after := e.patchIssue(u, issue.Key, map[string]any{
		"summary": "After", "description": "new text", "type": "bug", "statusId": inProgress.ID, "priority": "highest",
		"assigneeId": dev.ID, "reporterId": dev.ID, "parentId": epic.ID, "sprintId": sprint, "storyPoints": 2.5,
		"dueDate": "2026-11-05", "labelIds": []int64{backend.ID, api.ID, api.ID},
	})
	if after.Type != "bug" || after.Status.ID != inProgress.ID || after.Sprint == nil || len(after.Labels) != 2 ||
		after.Labels[0].Name != "api" || after.Labels[1].Name != "backend" {
		t.Fatalf("after: %+v", after)
	}

	rows := activitiesFor(e.issueActivity(u, issue.Key), "issue.updated", "")
	want := map[string][2]*string{
		"summary":     {strp("Before"), strp("After")},
		"description": {nil, nil},
		"type":        {strp("story"), strp("bug")},
		"status":      {strp("To Do"), strp("In Progress")},
		"priority":    {strp("medium"), strp("highest")},
		"assignee":    {nil, strp("Dev")},
		"reporter":    {strp("Owner"), strp("Dev")},
		"parent":      {nil, strp(epic.Key)},
		"sprint":      {nil, strp("GB Sprint 1")},
		"storyPoints": {nil, strp("2.5")},
		"dueDate":     {nil, strp("2026-11-05")},
		"labels":      {nil, strp("api, backend")},
	}
	if len(rows) != len(want) {
		t.Fatalf("got %d activity rows, want %d: %+v", len(rows), len(want), rows)
	}
	for _, r := range rows {
		w, ok := want[deref(r.Field)]
		if !ok {
			t.Errorf("unexpected field %s", deref(r.Field))
			continue
		}
		if deref(r.OldValue) != deref(w[0]) || deref(r.NewValue) != deref(w[1]) {
			t.Errorf("%s: old=%s new=%s, want old=%s new=%s", deref(r.Field), deref(r.OldValue), deref(r.NewValue), deref(w[0]), deref(w[1]))
		}
		if r.IssueID == nil || *r.IssueID != issue.ID || r.Actor == nil || r.Actor.ID != u.ID {
			t.Errorf("row metadata: %+v", r)
		}
	}
}

func TestLabelsReplaceWholeSet(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	a := e.createLabel(u, "GB", "Alpha")
	b := e.createLabel(u, "GB", "beta")
	c := e.createLabel(u, "GB", "Charlie")
	issue := e.newIssue(u, "GB", "task", "Labelled", map[string]any{"labelIds": []int64{c.ID, a.ID}})
	if len(issue.Labels) != 2 || issue.Labels[0].Name != "Alpha" || issue.Labels[1].Name != "Charlie" {
		t.Fatalf("create labels (sorted by name): %+v", issue.Labels)
	}
	replaced := e.patchIssue(u, issue.Key, map[string]any{"labelIds": []int64{b.ID}})
	if len(replaced.Labels) != 1 || replaced.Labels[0].ID != b.ID || replaced.Labels[0].Color != "#6B778C" {
		t.Fatalf("replace: %+v", replaced.Labels)
	}
	cleared := e.patchIssue(u, issue.Key, map[string]any{"labelIds": nil})
	if cleared.Labels == nil || len(cleared.Labels) != 0 {
		t.Fatalf("clear: %+v", cleared.Labels)
	}
	hist := activitiesFor(e.issueActivity(u, issue.Key), "issue.updated", "labels")
	if len(hist) != 2 || deref(hist[1].OldValue) != "Alpha, Charlie" || deref(hist[1].NewValue) != "beta" ||
		deref(hist[0].OldValue) != "beta" || hist[0].NewValue != nil {
		t.Fatalf("labels history (newest first): %+v", hist)
	}

	// Deleting a label removes it from issues.
	e.patchIssue(u, issue.Key, map[string]any{"labelIds": []int64{a.ID, b.ID}})
	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB/labels/"+itoa(a.ID), u.Token, nil), http.StatusNoContent)
	if got := e.getIssue(u, issue.Key).Labels; len(got) != 1 || got[0].ID != b.ID {
		t.Fatalf("after label delete: %+v", got)
	}
}

func TestIssueTypeChanges(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	epic := e.newIssue(u, "GB", "epic", "Epic", nil)
	story := e.newIssue(u, "GB", "story", "Story", map[string]any{"parentId": epic.ID})
	sub := e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": story.ID})

	bug := e.patchIssue(u, story.Key, map[string]any{"type": "bug"})
	if bug.Type != "bug" || bug.Parent == nil || bug.Parent.ID != epic.ID {
		t.Fatalf("story->bug: %+v", bug)
	}
	e.patchIssue(u, story.Key, map[string]any{"type": "task"})
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+story.Key, u.Token, map[string]any{"type": "epic"}), "type")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+story.Key, u.Token, map[string]any{"type": "subtask"}), "type")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+epic.Key, u.Token, map[string]any{"type": "story"}), "type")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+sub.Key, u.Token, map[string]any{"type": "task"}), "type")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+story.Key, u.Token, map[string]any{"parentId": story.ID}), "parentId")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+sub.Key, u.Token, map[string]any{"parentId": nil}), "parentId")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+epic.Key, u.Token, map[string]any{"sprintId": 1}), "sprintId")
	// Removing a story from its epic is allowed.
	if got := e.patchIssue(u, story.Key, map[string]any{"parentId": nil}); got.Parent != nil {
		t.Fatalf("unparent: %+v", got.Parent)
	}
}

func TestDeleteIssueSemantics(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	epic := e.newIssue(u, "GB", "epic", "Epic", nil)
	story := e.newIssue(u, "GB", "story", "Story", map[string]any{"parentId": epic.ID})
	sub1 := e.newIssue(u, "GB", "subtask", "Sub 1", map[string]any{"parentId": story.ID})
	sub2 := e.newIssue(u, "GB", "subtask", "Sub 2", map[string]any{"parentId": story.ID})
	other := e.newIssue(u, "GB", "task", "Other", nil)
	link := decodeAs[dto.IssueLink](t, e.do(http.MethodPost, "/api/issues/"+other.Key+"/links", u.Token, map[string]any{"type": "blocks", "targetKey": story.Key}), http.StatusCreated)
	_ = link

	// Deleting a standard issue deletes its subtasks.
	expectStatus(t, e.do(http.MethodDelete, "/api/issues/"+story.Key, u.Token, nil), http.StatusNoContent)
	for _, k := range []string{story.Key, sub1.Key, sub2.Key} {
		expectError(t, e.do(http.MethodGet, "/api/issues/"+k, u.Token, nil), http.StatusNotFound, "not_found")
	}
	if links := e.getIssue(u, other.Key).Links; len(links) != 0 {
		t.Fatalf("links of deleted issue remain: %+v", links)
	}

	// Deleting an epic unparents its children.
	child := e.newIssue(u, "GB", "task", "Child", map[string]any{"parentId": epic.ID})
	expectStatus(t, e.do(http.MethodDelete, "/api/issues/"+epic.Key, u.Token, nil), http.StatusNoContent)
	orphan := e.getIssue(u, child.Key)
	if orphan.Parent != nil {
		t.Fatalf("child still has parent: %+v", orphan.Parent)
	}
	if hist := activitiesFor(e.issueActivity(u, child.Key), "issue.updated", "parent"); len(hist) != 1 || deref(hist[0].OldValue) != epic.Key {
		t.Fatalf("unparent history: %+v", hist)
	}

	act := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/projects/GB/activity?limit=200", u.Token, nil), http.StatusOK)
	deleted := map[string]string{}
	for _, a := range activitiesFor(act, "issue.deleted", "") {
		if a.IssueID != nil {
			t.Errorf("issue.deleted row keeps issue id: %+v", a)
		}
		deleted[deref(a.IssueKey)] = deref(a.NewValue)
	}
	for key, summary := range map[string]string{story.Key: "Story", sub1.Key: "Sub 1", sub2.Key: "Sub 2", epic.Key: "Epic"} {
		if deleted[key] != summary {
			t.Errorf("issue.deleted for %s = %q, want %q (all: %v)", key, deleted[key], summary, deleted)
		}
	}
	// History of deleted issues keeps the key (issue_id is nulled by the FK).
	for _, a := range act {
		if a.Action == "issue.created" && deref(a.IssueKey) == story.Key && a.IssueID != nil {
			t.Errorf("created row of deleted issue still references it: %+v", a)
		}
	}
}

func TestIssueJSONShape(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	issue := e.newIssue(u, "GB", "task", "Shape", nil)

	res := e.do(http.MethodGet, "/api/issues/"+issue.Key, u.Token, nil)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(res.Body, &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"id", "key", "projectId", "projectKey", "type", "summary", "description", "status", "priority",
		"assignee", "reporter", "parent", "sprint", "labels", "storyPoints", "dueDate", "rank", "subtaskCount",
		"resolvedAt", "createdAt", "updatedAt", "children", "links"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("missing key %q in %s", k, res.Body)
		}
	}
	for k, want := range map[string]string{"assignee": "null", "parent": "null", "sprint": "null", "storyPoints": "null",
		"dueDate": "null", "resolvedAt": "null", "labels": "[]", "children": "[]", "links": "[]", "subtaskCount": "0"} {
		if string(raw[k]) != want {
			t.Errorf("%s = %s, want %s", k, raw[k], want)
		}
	}
	var created string
	_ = json.Unmarshal(raw["createdAt"], &created)
	if !strings.HasSuffix(created, "Z") || !strings.Contains(created, "T") {
		t.Errorf("createdAt not RFC 3339 UTC: %s", created)
	}
	var status map[string]json.RawMessage
	_ = json.Unmarshal(raw["status"], &status)
	if string(status["wipLimit"]) != "null" || string(status["category"]) != `"todo"` {
		t.Errorf("status shape: %s", raw["status"])
	}
}
