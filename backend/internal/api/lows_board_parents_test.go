package api

import (
	"net/http"
	"testing"
)

// A Kanban board hides issues resolved long ago, which can be the parent of an open subtask.
// The board still returns such parents (for lookups only), so clients can find the subtask's
// epic; parents that are on the board are not repeated.
func TestBoardReturnsParentsOfSubtasksItLeavesOut(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProjectOfType(u, "OPS", "kanban")
	done := e.statusNamed(u, "OPS", "Done")

	epic := e.newIssue(u, "OPS", "epic", "Payments", nil)
	story := e.newIssue(u, "OPS", "story", "Card payments", map[string]any{"parentId": epic.ID})
	sub := e.newIssue(u, "OPS", "subtask", "Follow-up", map[string]any{"parentId": story.ID})
	open := e.newIssue(u, "OPS", "story", "Open story", nil)
	openSub := e.newIssue(u, "OPS", "subtask", "Parent on the board", map[string]any{"parentId": open.ID})

	res := e.do(http.MethodGet, "/api/projects/OPS/board", u.Token, nil)
	if raw := mustRaw(t, res.Body); string(raw["parents"]) != "[]" {
		t.Fatalf("board with every parent listed: parents = %s", raw["parents"])
	}

	e.moveIssue(u, story.Key, map[string]any{"statusId": done.ID})
	e.exec(`UPDATE issues SET resolved_at = now() - interval '20 days' WHERE key = $1`, story.Key)
	b := e.board(u, "OPS")
	expectKeys(t, b.Issues, sub.Key, open.Key, openSub.Key)
	expectKeys(t, b.Parents, story.Key)
	if p := b.Parents[0].Parent; p == nil || p.Key != epic.Key {
		t.Fatalf("hidden parent's epic: %+v", p)
	}

	// Scrum without an active sprint: no issues, no parents, both still arrays.
	e.createProject(u, "GB")
	res = e.do(http.MethodGet, "/api/projects/GB/board", u.Token, nil)
	if raw := mustRaw(t, res.Body); string(raw["issues"]) != "[]" || string(raw["parents"]) != "[]" {
		t.Fatalf("empty scrum board JSON: %s", res.Body)
	}
}
