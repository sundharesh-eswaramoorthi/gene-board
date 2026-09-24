package api

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"geneboard/internal/dto"
	"geneboard/internal/realtime"
)

// drainEvents returns the events already queued on a hub subscription (events are
// published before the request that caused them returns).
func drainEvents(sub *realtime.Subscription) []string {
	var out []string
	for {
		select {
		case ev := <-sub.C:
			key := "<nil>"
			if ev.IssueKey != nil {
				key = *ev.IssueKey
			}
			out = append(out, ev.Type+" "+ev.ProjectKey+" "+key)
		case <-time.After(50 * time.Millisecond):
			return out
		}
	}
}

// Deleting an issue (with its subtasks) or a whole project removes their links by cascade,
// including links to issues of other projects: those projects are told, as when a link is
// deleted explicitly, so their open issue views drop the dead link.
func TestDeletingLinkedIssuesNotifiesOtherProjects(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	ops := e.createProject(u, "OPS")
	x := e.newIssue(u, "GB", "story", "X", nil)
	xSub := e.newIssue(u, "GB", "subtask", "X sub", map[string]any{"parentId": x.ID})
	sibling := e.newIssue(u, "GB", "task", "Sibling", nil)
	y := e.newIssue(u, "OPS", "task", "Y", nil)
	z := e.newIssue(u, "OPS", "task", "Z", nil)
	e.newIssue(u, "OPS", "task", "Unlinked", nil)
	link := func(from, linkType, to string) {
		t.Helper()
		decodeAs[dto.IssueLink](t, e.do(http.MethodPost, "/api/issues/"+from+"/links", u.Token,
			map[string]any{"type": linkType, "targetKey": to}), http.StatusCreated)
	}
	link(x.Key, "blocks", y.Key)        // outward from the deleted issue
	link(z.Key, "relates", xSub.Key)    // inward, to a subtask deleted with it
	link(x.Key, "relates", sibling.Key) // same project: its issue.deleted event covers it

	sub := e.hub.Subscribe(ops.ID)
	defer e.hub.Unsubscribe(sub)
	expectStatus(t, e.do(http.MethodDelete, "/api/issues/"+x.Key, u.Token, nil), http.StatusNoContent)
	want := []string{"issue.updated OPS " + y.Key, "issue.updated OPS " + z.Key}
	if got := drainEvents(sub); !slices.Equal(got, want) {
		t.Fatalf("OPS events after deleting %s: %v, want %v", x.Key, got, want)
	}
	for _, key := range []string{y.Key, z.Key} {
		if links := e.getIssue(u, key).Links; len(links) != 0 {
			t.Fatalf("%s still has links: %+v", key, links)
		}
	}

	w := e.newIssue(u, "GB", "task", "W", nil)
	link(y.Key, "blocks", w.Key)
	link(w.Key, "clones", z.Key)
	link(sibling.Key, "duplicates", z.Key)
	drainEvents(sub)
	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB", u.Token, nil), http.StatusNoContent)
	if got := drainEvents(sub); !slices.Equal(got, want) {
		t.Fatalf("OPS events after deleting project GB: %v, want %v", got, want)
	}
}

// A drag & drop that names a neighbour deleted meanwhile (the client's list is stale) is not
// rejected: the missing neighbour is ignored and the rest of the move applies. An issue of
// another project is ignored alike, so the answer does not reveal whether an id exists.
func TestMoveIgnoresDeletedNeighbours(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	inProgress := e.statusNamed(u, "GB", "In Progress")
	done := e.statusNamed(u, "GB", "Done")
	ids := map[string]int64{}
	for range 5 {
		is := e.newIssue(u, "GB", "task", "Task", nil)
		ids[is.Key] = is.ID
	}
	for _, key := range []string{"GB-2", "GB-4"} {
		expectStatus(t, e.do(http.MethodDelete, "/api/issues/"+key, u.Token, nil), http.StatusNoContent)
	}
	expect := func(want ...string) {
		t.Helper()
		if got := e.rankedKeys(u, "GB"); !slices.Equal(got, want) {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}

	// Dropped between deleted GB-2 and GB-3: right above GB-3, in the new column.
	moved := e.moveIssue(u, "GB-5", map[string]any{"statusId": inProgress.ID, "prevIssueId": ids["GB-2"], "nextIssueId": ids["GB-3"]})
	if moved.Status.ID != inProgress.ID {
		t.Fatalf("status = %s", moved.Status.Name)
	}
	expect("GB-1", "GB-5", "GB-3")
	// Dropped between GB-3 and deleted GB-4: right below GB-3.
	e.moveIssue(u, "GB-5", map[string]any{"prevIssueId": ids["GB-3"], "nextIssueId": ids["GB-4"]})
	expect("GB-1", "GB-3", "GB-5")
	// Both neighbours gone: the rank stays, the status change still applies.
	if moved = e.moveIssue(u, "GB-1", map[string]any{"statusId": done.ID, "prevIssueId": ids["GB-2"], "nextIssueId": ids["GB-4"]}); moved.Status.ID != done.ID {
		t.Fatalf("status = %s", moved.Status.Name)
	}
	expect("GB-1", "GB-3", "GB-5")

	// An issue of a project the mover is not a member of counts as not given, as a missing
	// one does: the other neighbour still places the issue, and alone it leaves the rank.
	stranger := e.createUser("Stranger")
	e.createProject(stranger, "OPS")
	elsewhere := e.newIssue(stranger, "OPS", "task", "Elsewhere", nil)
	e.moveIssue(u, "GB-5", map[string]any{"prevIssueId": elsewhere.ID, "nextIssueId": ids["GB-1"]})
	expect("GB-5", "GB-1", "GB-3")
	for _, id := range []int64{elsewhere.ID, ids["GB-2"]} {
		e.moveIssue(u, "GB-1", map[string]any{"prevIssueId": id})
		e.moveIssue(u, "GB-1", map[string]any{"nextIssueId": id})
	}
	expect("GB-5", "GB-1", "GB-3")
}

// Kanban projects do not use sprints: issues cannot join a sprint left over from before the
// switch (through create, PATCH or move), but issues already in one keep it until they are
// taken out of it, and their subtasks still share it.
func TestKanbanIssuesCannotJoinLeftoverSprints(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	active := e.createSprint(u, "GB", nil)
	planned := e.createSprint(u, "GB", nil)
	inSprint := e.newIssue(u, "GB", "story", "In the running sprint", map[string]any{"sprintId": active.ID})
	free := e.newIssue(u, "GB", "task", "Never in a sprint", nil)
	e.startSprint(u, active.ID, "2026-09-01", "2026-09-14")
	decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/GB", u.Token, map[string]any{"type": "kanban"}), http.StatusOK)

	refused := []*testResponse{
		e.do(http.MethodPost, "/api/projects/GB/issues", u.Token, map[string]any{"type": "task", "summary": "New", "sprintId": planned.ID}),
		e.do(http.MethodPatch, "/api/issues/"+free.Key, u.Token, map[string]any{"sprintId": planned.ID}),
		e.do(http.MethodPatch, "/api/issues/"+inSprint.Key, u.Token, map[string]any{"sprintId": planned.ID}),
		e.do(http.MethodPost, "/api/issues/"+free.Key+"/move", u.Token, map[string]any{"sprintId": active.ID}),
	}
	for _, res := range refused {
		if msg := expectFieldError(t, res, "sprintId").Message; msg != "Sprint must be empty (Kanban projects do not use sprints)" {
			t.Fatalf("message = %q", msg)
		}
	}

	// Staying in the leftover sprint is fine, and a new subtask shares it.
	e.moveIssue(u, inSprint.Key, map[string]any{"sprintId": active.ID, "nextIssueId": free.ID})
	e.patchIssue(u, inSprint.Key, map[string]any{"sprintId": active.ID, "summary": "Renamed"})
	sub := e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": inSprint.ID})
	if sprintIDOf(sub.Issue) != active.ID {
		t.Fatalf("subtask sprint = %v", sub.Sprint)
	}
	// Leaving it is fine too; the subtask follows.
	if left := e.patchIssue(u, inSprint.Key, map[string]any{"sprintId": nil}); left.Sprint != nil {
		t.Fatalf("sprint after clearing = %v", left.Sprint)
	}
	if s := e.getIssue(u, sub.Key).Sprint; s != nil {
		t.Fatalf("subtask sprint after its parent left = %v", s)
	}
	for _, s := range e.listSprints(u, "GB", "") {
		if s.IssueCount != 0 {
			t.Fatalf("%s holds %d issues", s.Name, s.IssueCount)
		}
	}
}

// A subtask's sprint is its parent's: an explicit null on create (the backlog) is refused
// when the parent is in a sprint, as on PATCH and move, and accepted when it is not.
func TestCreateSubtaskWithNullSprint(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	sp := e.createSprint(u, "GB", nil)
	inSprint := e.newIssue(u, "GB", "story", "In a sprint", map[string]any{"sprintId": sp.ID})
	inBacklog := e.newIssue(u, "GB", "story", "In the backlog", nil)

	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/issues", u.Token, map[string]any{
		"type": "subtask", "summary": "Sub", "parentId": inSprint.ID, "sprintId": nil,
	}), "sprintId")
	if sub := e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": inBacklog.ID, "sprintId": nil}); sub.Sprint != nil {
		t.Fatalf("subtask of a backlog story in %v", sub.Sprint)
	}
	if sub := e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": inSprint.ID}); sprintIDOf(sub.Issue) != sp.ID {
		t.Fatalf("subtask did not inherit the sprint: %v", sub.Sprint)
	}
	// null keeps meaning "no sprint" for other issue types.
	for _, issueType := range []string{"task", "epic"} {
		if is := e.newIssue(u, "GB", issueType, "No sprint", map[string]any{"sprintId": nil}); is.Sprint != nil {
			t.Fatalf("%s in %v", issueType, is.Sprint)
		}
	}
}
