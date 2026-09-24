package api

import (
	"net/http"
	"testing"
)

func TestScrumBoard(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	viewer := e.createUser("Viewer")
	outsider := e.createUser("Outsider")
	e.createProject(owner, "GB")
	e.addMember(owner, "GB", viewer, "viewer")

	// No active sprint: empty board, but project and columns are still returned.
	empty := e.board(viewer, "GB")
	if empty.Sprint != nil || len(empty.Issues) != 0 || len(empty.Statuses) != 4 || empty.Project.Key != "GB" || empty.Project.MyRole != "viewer" {
		t.Fatalf("empty board: %+v", empty)
	}
	res := e.do(http.MethodGet, "/api/projects/GB/board", owner.Token, nil)
	if raw := mustRaw(t, res.Body); string(raw["sprint"]) != "null" || string(raw["issues"]) != "[]" {
		t.Fatalf("empty board JSON: %s", res.Body)
	}

	active := e.createSprint(owner, "GB", nil)
	planned := e.createSprint(owner, "GB", nil)
	epic := e.newIssue(owner, "GB", "epic", "Epic", nil)
	story := e.newIssue(owner, "GB", "story", "Story", map[string]any{"sprintId": active.ID, "parentId": epic.ID, "storyPoints": 5})
	sub := e.newIssue(owner, "GB", "subtask", "Subtask", map[string]any{"parentId": story.ID})
	bug := e.newIssue(owner, "GB", "bug", "Bug", map[string]any{"sprintId": active.ID})
	e.newIssue(owner, "GB", "task", "Planned task", map[string]any{"sprintId": planned.ID})
	e.newIssue(owner, "GB", "task", "Backlog task", nil)
	e.startSprint(owner, active.ID, "2026-09-21", "2026-10-04")
	// Rank order, not creation order: put the bug first.
	e.moveIssue(owner, bug.Key, map[string]any{"nextIssueId": story.ID})

	b := e.board(owner, "GB")
	if b.Sprint == nil || b.Sprint.ID != active.ID || b.Sprint.State != "active" || b.Sprint.IssueCount != 2 || b.Sprint.PointsTotal != 5 {
		t.Fatalf("board sprint: %+v", b.Sprint)
	}
	expectKeys(t, b.Issues, bug.Key, story.Key, sub.Key)
	if b.Issues[1].Parent == nil || b.Issues[1].Parent.Key != epic.Key || b.Issues[1].SubtaskCount != 1 {
		t.Fatalf("hydrated story: %+v", b.Issues[1])
	}
	if b.Project.IssueCount != 6 || len(b.Statuses) != 4 || b.Statuses[0].Name != "To Do" {
		t.Fatalf("board project/statuses: %+v %+v", b.Project, b.Statuses)
	}
	expectError(t, e.do(http.MethodGet, "/api/projects/GB/board", outsider.Token, nil), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodGet, "/api/projects/NOPE/board", owner.Token, nil), http.StatusNotFound, "not_found")

	// After completion there is no active sprint again.
	e.completeSprint(owner, active.ID, map[string]any{"target": "sprint", "sprintId": planned.ID})
	if b := e.board(owner, "GB"); b.Sprint != nil || len(b.Issues) != 0 {
		t.Fatalf("board after completion: %+v", b)
	}
}

func TestKanbanBoardHidesLongResolvedIssues(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProjectOfType(u, "OPS", "kanban")
	done := e.statusNamed(u, "OPS", "Done")
	inProgress := e.statusNamed(u, "OPS", "In Progress")

	e.newIssue(u, "OPS", "epic", "Epic", nil)
	todo := e.newIssue(u, "OPS", "task", "Todo", nil)
	doing := e.newIssue(u, "OPS", "bug", "Doing", map[string]any{"statusId": inProgress.ID})
	sub := e.newIssue(u, "OPS", "subtask", "Sub", map[string]any{"parentId": doing.ID})
	fresh := e.newIssue(u, "OPS", "task", "Resolved today", map[string]any{"statusId": done.ID})
	recent := e.newIssue(u, "OPS", "task", "Resolved 13 days ago", map[string]any{"statusId": done.ID})
	old := e.newIssue(u, "OPS", "task", "Resolved 15 days ago", map[string]any{"statusId": done.ID})
	e.exec(`UPDATE issues SET resolved_at = now() - interval '13 days' WHERE key = $1`, recent.Key)
	e.exec(`UPDATE issues SET resolved_at = now() - interval '15 days' WHERE key = $1`, old.Key)

	b := e.board(u, "OPS")
	if b.Sprint != nil || b.Project.Type != "kanban" {
		t.Fatalf("kanban board header: %+v", b)
	}
	expectKeys(t, b.Issues, todo.Key, doing.Key, sub.Key, fresh.Key, recent.Key)

	// Reopening the old issue brings it back.
	e.moveIssue(u, old.Key, map[string]any{"statusId": inProgress.ID})
	expectKeys(t, e.board(u, "OPS").Issues, todo.Key, doing.Key, sub.Key, fresh.Key, recent.Key, old.Key)
}

func TestBacklogGroupingAndOrder(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	done := e.statusNamed(u, "GB", "Done")

	closed := e.createSprint(u, "GB", nil)
	first := e.createSprint(u, "GB", nil)
	activeSp := e.createSprint(u, "GB", nil)
	emptySp := e.createSprint(u, "GB", nil)

	epic := e.newIssue(u, "GB", "epic", "Epic", nil)
	a1 := e.newIssue(u, "GB", "story", "Active 1", map[string]any{"sprintId": activeSp.ID, "parentId": epic.ID})
	a2 := e.newIssue(u, "GB", "task", "Active 2", map[string]any{"sprintId": activeSp.ID})
	e.newIssue(u, "GB", "subtask", "Sub of active 1", map[string]any{"parentId": a1.ID})
	p1 := e.newIssue(u, "GB", "bug", "Planned 1", map[string]any{"sprintId": first.ID})
	b1 := e.newIssue(u, "GB", "task", "Backlog 1", nil)
	b2 := e.newIssue(u, "GB", "story", "Backlog 2", nil)
	e.newIssue(u, "GB", "subtask", "Sub of backlog 2", map[string]any{"parentId": b2.ID})
	history := e.newIssue(u, "GB", "task", "Done in closed sprint", map[string]any{"sprintId": closed.ID, "statusId": done.ID})
	reopened := e.newIssue(u, "GB", "task", "Reopened after close", map[string]any{"sprintId": closed.ID, "statusId": done.ID})

	e.startSprint(u, closed.ID, "2026-09-01", "2026-09-14")
	e.completeSprint(u, closed.ID, map[string]any{"target": "backlog"})
	// Reopening an issue of a completed sprint puts it back on the backlog page.
	e.patchIssue(u, reopened.Key, map[string]any{"statusId": e.statusNamed(u, "GB", "To Do").ID})
	e.startSprint(u, activeSp.ID, "2026-09-15", "2026-09-28")
	// Reorder within sections: a2 above a1, b2 above b1.
	e.moveIssue(u, a2.Key, map[string]any{"nextIssueId": a1.ID})
	e.moveIssue(u, b2.Key, map[string]any{"nextIssueId": b1.ID})

	bl := e.backlog(u, "GB")
	if len(bl.Sprints) != 3 {
		t.Fatalf("sprint sections: %+v", bl.Sprints)
	}
	if bl.Sprints[0].Sprint.ID != activeSp.ID || bl.Sprints[1].Sprint.ID != first.ID || bl.Sprints[2].Sprint.ID != emptySp.ID {
		t.Fatalf("section order: %v", []string{bl.Sprints[0].Sprint.Name, bl.Sprints[1].Sprint.Name, bl.Sprints[2].Sprint.Name})
	}
	expectKeys(t, bl.Sprints[0].Issues, a2.Key, a1.Key)
	expectKeys(t, bl.Sprints[1].Issues, p1.Key)
	expectKeys(t, bl.Sprints[2].Issues)
	if bl.Sprints[2].Issues == nil || bl.Sprints[0].Sprint.IssueCount != 2 {
		t.Fatalf("empty section must be [] and stats filled: %+v", bl.Sprints)
	}
	expectKeys(t, bl.Backlog, b2.Key, b1.Key, reopened.Key)
	for _, is := range bl.Backlog {
		if is.Key == history.Key {
			t.Fatal("done issues of completed sprints are not part of the backlog")
		}
	}

	// Kanban projects: no sprints, every standard issue in one ranked list.
	e.createProjectOfType(u, "OPS", "kanban")
	k1 := e.newIssue(u, "OPS", "task", "K1", nil)
	kEpic := e.newIssue(u, "OPS", "epic", "K epic", nil)
	k2 := e.newIssue(u, "OPS", "bug", "K2", map[string]any{"parentId": kEpic.ID})
	res := e.do(http.MethodGet, "/api/projects/OPS/backlog", u.Token, nil)
	if raw := mustRaw(t, res.Body); string(raw["sprints"]) != "[]" {
		t.Fatalf("kanban backlog JSON: %s", res.Body)
	}
	expectKeys(t, e.backlog(u, "OPS").Backlog, k1.Key, k2.Key)
}

func TestEpicsProgress(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	viewer := e.createUser("Viewer")
	e.createProject(owner, "GB")
	e.addMember(owner, "GB", viewer, "viewer")
	done := e.statusNamed(owner, "GB", "Done")
	review := e.statusNamed(owner, "GB", "In Review")

	if eps := e.epics(viewer, "GB"); eps == nil || len(eps) != 0 {
		t.Fatalf("no epics must be []: %+v", eps)
	}
	res := e.do(http.MethodGet, "/api/projects/GB/epics", owner.Token, nil)
	if string(res.Body) != "[]\n" {
		t.Fatalf("empty epics JSON: %q", res.Body)
	}

	e1 := e.newIssue(owner, "GB", "epic", "Checkout", map[string]any{"dueDate": "2026-12-01"})
	e2 := e.newIssue(owner, "GB", "epic", "Empty epic", nil)
	story := e.newIssue(owner, "GB", "story", "Todo story", map[string]any{"parentId": e1.ID, "storyPoints": 3})
	e.newIssue(owner, "GB", "task", "Reviewing", map[string]any{"parentId": e1.ID, "storyPoints": 2, "statusId": review.ID})
	e.newIssue(owner, "GB", "bug", "Fixed", map[string]any{"parentId": e1.ID, "storyPoints": 5, "statusId": done.ID})
	e.newIssue(owner, "GB", "subtask", "Not counted", map[string]any{"parentId": story.ID, "storyPoints": 13, "statusId": done.ID})
	e.newIssue(owner, "GB", "task", "No epic", map[string]any{"storyPoints": 1})

	eps := e.epics(viewer, "GB")
	if len(eps) != 2 || eps[0].Epic.Key != e1.Key || eps[1].Epic.Key != e2.Key {
		t.Fatalf("epics: %+v", eps)
	}
	p := eps[0]
	if p.Total != 3 || p.Done != 1 || p.InProgress != 1 || p.PointsTotal != 10 || p.PointsDone != 5 {
		t.Fatalf("progress: %+v", p)
	}
	if p.Epic.Type != "epic" || p.Epic.DueDate == nil || p.Epic.DueDate.String() != "2026-12-01" || p.Epic.Labels == nil {
		t.Fatalf("hydrated epic: %+v", p.Epic)
	}
	if z := eps[1]; z.Total != 0 || z.Done != 0 || z.InProgress != 0 || z.PointsTotal != 0 {
		t.Fatalf("empty epic: %+v", z)
	}
	expectError(t, e.do(http.MethodGet, "/api/projects/GB/epics", e.createUser("Outsider").Token, nil), http.StatusNotFound, "not_found")

	// Deleting a child updates the numbers.
	expectStatus(t, e.do(http.MethodDelete, "/api/issues/"+story.Key, owner.Token, nil), http.StatusNoContent)
	if p := e.epics(owner, "GB")[0]; p.Total != 2 || p.PointsTotal != 7 {
		t.Fatalf("after delete: %+v", p)
	}
}
