package api

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"geneboard/internal/dto"
	"geneboard/internal/realtime"
)

func sprintNames(sprints []dto.Sprint) []string {
	out := make([]string, len(sprints))
	for i, s := range sprints {
		out[i] = s.Name
	}
	return out
}

func TestSprintCreateDefaultsAndNaming(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	p := e.createProject(u, "GB")

	// No body at all: every field is optional.
	first := decodeAs[dto.Sprint](t, e.do(http.MethodPost, "/api/projects/gb/sprints", u.Token, nil), http.StatusCreated)
	if first.Name != "GB Sprint 1" || first.State != "planned" || first.Goal != "" || first.ProjectID != p.ID ||
		first.StartDate != nil || first.EndDate != nil || first.CompletedAt != nil || first.IssueCount != 0 {
		t.Fatalf("default sprint: %+v", first)
	}
	custom := e.createSprint(u, "GB", map[string]any{"name": "  Launch  ", "goal": " Ship it ", "startDate": "2026-10-01", "endDate": "2026-10-14"})
	if custom.Name != "Launch" || custom.Goal != "Ship it" || custom.StartDate.String() != "2026-10-01" || custom.EndDate.String() != "2026-10-14" {
		t.Fatalf("custom sprint: %+v", custom)
	}
	third := e.createSprint(u, "GB", nil)
	if third.Name != "GB Sprint 3" {
		t.Fatalf("third default name = %q", third.Name)
	}
	// n counts every sprint ever created, including deleted ones...
	expectStatus(t, e.do(http.MethodDelete, sprintPath(third.ID, ""), u.Token, nil), http.StatusNoContent)
	if s := e.createSprint(u, "GB", map[string]any{"name": ""}); s.Name != "GB Sprint 4" {
		t.Fatalf("name after a deletion = %q, want GB Sprint 4", s.Name)
	}
	// ...and skips names that are already taken.
	e.createSprint(u, "GB", map[string]any{"name": "gb sprint 6"})
	if s := e.createSprint(u, "GB", nil); s.Name != "GB Sprint 7" {
		t.Fatalf("name skipping a taken one = %q, want GB Sprint 7", s.Name)
	}

	created := activitiesFor(e.projectActivity(u, "GB"), "sprint.created", "")
	if len(created) != 6 || deref(created[0].NewValue) != "GB Sprint 7" || created[0].IssueID != nil {
		t.Fatalf("sprint.created activity: %+v", created)
	}

	// Validation.
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/sprints", u.Token, map[string]any{"startDate": "2026-10-10", "endDate": "2026-10-09"}), "endDate")
	long := make([]byte, 81)
	for i := range long {
		long[i] = 'x'
	}
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/sprints", u.Token, map[string]any{"name": string(long)}), "name")
	expectError(t, e.do(http.MethodPost, "/api/projects/GB/sprints", u.Token, map[string]any{"startDate": "10/01/2026"}), http.StatusBadRequest, "bad_request")
	expectError(t, e.do(http.MethodPost, "/api/projects/GB/sprints", u.Token, `{"name":`), http.StatusBadRequest, "bad_request")

	// Kanban projects do not use sprints.
	e.createProjectOfType(u, "OPS", "kanban")
	kanban := expectError(t, e.do(http.MethodPost, "/api/projects/OPS/sprints", u.Token, nil), http.StatusBadRequest, "validation_error")
	if kanban.Message != "Kanban projects do not use sprints" {
		t.Fatalf("kanban message = %q", kanban.Message)
	}
}

func TestSprintPermissions(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	viewer := e.createUser("Viewer")
	outsider := e.createUser("Outsider")
	e.createProject(owner, "GB")
	e.addMember(owner, "GB", viewer, "viewer")
	sp := e.createSprint(owner, "GB", nil)

	// Viewers can read but not write.
	if got := e.getSprint(viewer, sp.ID); got.ID != sp.ID {
		t.Fatalf("viewer get: %+v", got)
	}
	if len(e.listSprints(viewer, "GB", "")) != 1 {
		t.Fatal("viewer list")
	}
	for _, r := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/api/projects/GB/sprints", map[string]any{}},
		{http.MethodPatch, sprintPath(sp.ID, ""), map[string]any{"name": "x"}},
		{http.MethodDelete, sprintPath(sp.ID, ""), nil},
		{http.MethodPost, sprintPath(sp.ID, "/start"), map[string]any{"startDate": "2026-10-01", "endDate": "2026-10-14"}},
		{http.MethodPost, sprintPath(sp.ID, "/complete"), map[string]any{"target": "backlog"}},
	} {
		expectError(t, e.do(r.method, r.path, viewer.Token, r.body), http.StatusForbidden, "forbidden")
		// Non-members cannot even tell that the sprint exists.
		expectError(t, e.do(r.method, r.path, outsider.Token, r.body), http.StatusNotFound, "not_found")
	}
	expectError(t, e.do(http.MethodGet, sprintPath(sp.ID, ""), outsider.Token, nil), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodGet, "/api/projects/GB/sprints", outsider.Token, nil), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodGet, sprintPath(999999, ""), owner.Token, nil), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodGet, "/api/sprints/abc", owner.Token, nil), http.StatusBadRequest, "bad_request")
	expectError(t, e.do(http.MethodGet, sprintPath(sp.ID, ""), "", nil), http.StatusUnauthorized, "unauthorized")
}

func TestSprintListOrderAndFilter(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	s1 := e.createSprint(u, "GB", nil)
	s2 := e.createSprint(u, "GB", nil)
	s3 := e.createSprint(u, "GB", nil)
	s4 := e.createSprint(u, "GB", nil)
	s5 := e.createSprint(u, "GB", nil)

	// s1 then s2 are completed (s2 most recently), s4 is active; s3 and s5 stay planned.
	e.startSprint(u, s1.ID, "2026-09-01", "2026-09-14")
	e.completeSprint(u, s1.ID, map[string]any{"target": "backlog"})
	e.startSprint(u, s2.ID, "2026-09-15", "2026-09-28")
	e.completeSprint(u, s2.ID, map[string]any{"target": "backlog"})
	e.startSprint(u, s4.ID, "2026-09-29", "2026-10-12")

	want := []string{s4.Name, s3.Name, s5.Name, s2.Name, s1.Name}
	if got := sprintNames(e.listSprints(u, "GB", "")); !slices.Equal(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
	if got := sprintNames(e.listSprints(u, "GB", "state=planned,active")); !slices.Equal(got, want[:3]) {
		t.Fatalf("planned,active = %v", got)
	}
	if got := sprintNames(e.listSprints(u, "GB", "state=completed&state=")); !slices.Equal(got, want[3:]) {
		t.Fatalf("completed = %v", got)
	}
	if got := e.listSprints(u, "GB", "state=ACTIVE"); len(got) != 1 || got[0].ID != s4.ID || got[0].State != "active" {
		t.Fatalf("active = %+v", got)
	}
	expectError(t, e.do(http.MethodGet, "/api/projects/GB/sprints?state=done", u.Token, nil), http.StatusBadRequest, "bad_request")

	// JSON shape of a Sprint.
	res := e.do(http.MethodGet, sprintPath(s1.ID, ""), u.Token, nil)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(res.Body, &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"id", "projectId", "name", "goal", "state", "startDate", "endDate", "completedAt",
		"issueCount", "pointsTotal", "pointsDone", "createdAt", "updatedAt"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("sprint JSON lacks %q: %s", k, res.Body)
		}
	}
	if string(raw["startDate"]) != `"2026-09-01"` || string(raw["completedAt"]) == "null" || string(raw["issueCount"]) != "0" {
		t.Errorf("sprint JSON values: %s", res.Body)
	}
	if res := e.do(http.MethodGet, sprintPath(s3.ID, ""), u.Token, nil); !json.Valid(res.Body) ||
		string(mustRaw(t, res.Body)["completedAt"]) != "null" || string(mustRaw(t, res.Body)["startDate"]) != "null" {
		t.Errorf("planned sprint JSON: %s", res.Body)
	}
}

func mustRaw(t *testing.T, body []byte) map[string]json.RawMessage {
	t.Helper()
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return raw
}

func TestSprintUpdate(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	sp := e.createSprint(u, "GB", map[string]any{"goal": "Old goal", "startDate": "2026-10-01", "endDate": "2026-10-14"})
	patch := func(body any) *testResponse { return e.do(http.MethodPatch, sprintPath(sp.ID, ""), u.Token, body) }

	updated := decodeAs[dto.Sprint](t, patch(map[string]any{"name": " Renamed ", "goal": nil, "endDate": "2026-10-21"}), http.StatusOK)
	if updated.Name != "Renamed" || updated.Goal != "" || updated.StartDate.String() != "2026-10-01" || updated.EndDate.String() != "2026-10-21" {
		t.Fatalf("patched: %+v", updated)
	}
	// Absent fields are unchanged and a no-op PATCH does not bump updatedAt.
	same := decodeAs[dto.Sprint](t, patch(map[string]any{"name": "Renamed"}), http.StatusOK)
	if !same.UpdatedAt.Equal(updated.UpdatedAt.Time) {
		t.Fatal("no-op PATCH bumped updatedAt")
	}
	cleared := decodeAs[dto.Sprint](t, patch(map[string]any{"startDate": nil, "endDate": nil}), http.StatusOK)
	if cleared.StartDate != nil || cleared.EndDate != nil {
		t.Fatalf("dates not cleared: %+v", cleared)
	}

	expectFieldError(t, patch(map[string]any{"name": nil}), "name")
	expectFieldError(t, patch(map[string]any{"name": "   "}), "name")
	expectFieldError(t, patch(map[string]any{"startDate": "2026-10-10", "endDate": "2026-10-01"}), "endDate")
	expectError(t, patch(`{}garbage`), http.StatusBadRequest, "bad_request")

	// An active sprint must keep its dates; the end date is checked against the stored start.
	e.startSprint(u, sp.ID, "2026-10-01", "2026-10-14")
	expectFieldError(t, patch(map[string]any{"startDate": nil}), "startDate")
	expectFieldError(t, patch(map[string]any{"endDate": "2026-09-30"}), "endDate")
	if s := decodeAs[dto.Sprint](t, patch(map[string]any{"endDate": "2026-10-15", "goal": "Extended"}), http.StatusOK); s.State != "active" || s.EndDate.String() != "2026-10-15" {
		t.Fatalf("active sprint patch: %+v", s)
	}

	// Completed sprints are read-only.
	e.completeSprint(u, sp.ID, map[string]any{"target": "backlog"})
	expectError(t, patch(map[string]any{"name": "Too late"}), http.StatusConflict, "conflict")
}

func TestSprintStart(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	a := e.createSprint(u, "GB", nil)
	b := e.createSprint(u, "GB", map[string]any{"startDate": "2026-11-01", "endDate": "2026-11-14"})
	start := func(id int64, body any) *testResponse {
		return e.do(http.MethodPost, sprintPath(id, "/start"), u.Token, body)
	}

	// Dates are required (from the body or already stored) and must be ordered.
	missing := expectFieldError(t, start(a.ID, nil), "startDate")
	if _, ok := missing.Fields["endDate"]; !ok {
		t.Fatalf("both dates should be reported: %+v", missing)
	}
	expectFieldError(t, start(a.ID, map[string]any{"startDate": "2026-10-14", "endDate": "2026-10-01"}), "endDate")
	expectFieldError(t, start(a.ID, map[string]any{"startDate": "2026-10-01", "endDate": "2026-10-14", "name": ""}), "name")

	started := decodeAs[dto.Sprint](t, start(a.ID, map[string]any{
		"startDate": "2026-10-01", "endDate": "2026-10-01", "name": "Kick-off", "goal": "First increment",
	}), http.StatusOK)
	if started.State != "active" || started.Name != "Kick-off" || started.Goal != "First increment" ||
		started.StartDate.String() != "2026-10-01" || started.EndDate.String() != "2026-10-01" {
		t.Fatalf("started: %+v", started)
	}
	if acts := activitiesFor(e.projectActivity(u, "GB"), "sprint.started", ""); len(acts) != 1 || deref(acts[0].NewValue) != "Kick-off" {
		t.Fatalf("sprint.started activity: %+v", acts)
	}

	// Only one active sprint per project; only planned sprints can be started.
	expectError(t, start(b.ID, nil), http.StatusConflict, "conflict")
	expectError(t, start(a.ID, map[string]any{"startDate": "2026-10-01", "endDate": "2026-10-14"}), http.StatusConflict, "conflict")

	// Once the active sprint is completed, b starts with its stored dates and no body.
	e.completeSprint(u, a.ID, nil)
	expectError(t, start(a.ID, map[string]any{"startDate": "2026-10-01", "endDate": "2026-10-14"}), http.StatusConflict, "conflict")
	if s := decodeAs[dto.Sprint](t, start(b.ID, nil), http.StatusOK); s.State != "active" || s.StartDate.String() != "2026-11-01" {
		t.Fatalf("start with stored dates: %+v", s)
	}

	// A project switched to Kanban cannot start sprints.
	c := e.createSprint(u, "GB", nil)
	decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/GB", u.Token, map[string]any{"type": "kanban"}), http.StatusOK)
	expectError(t, start(c.ID, map[string]any{"startDate": "2026-12-01", "endDate": "2026-12-14"}), http.StatusBadRequest, "validation_error")
}

// sprintFixture is a Scrum project with an active sprint holding a mix of done and open
// issues (with subtasks), used by the completion tests.
type sprintFixture struct {
	owner                        testUser
	active                       dto.Sprint
	doneStory, openStory         dto.IssueDetail // each with one subtask
	doneStorySub, openStorySub   dto.IssueDetail
	openBug, doneTask, backlogIt dto.IssueDetail
}

func newSprintFixture(e *testEnv) sprintFixture {
	e.t.Helper()
	var f sprintFixture
	f.owner = e.createUser("Owner")
	e.createProject(f.owner, "GB")
	done := e.statusNamed(f.owner, "GB", "Done")
	inProgress := e.statusNamed(f.owner, "GB", "In Progress")

	f.active = e.createSprint(f.owner, "GB", nil)
	with := func(extra map[string]any) map[string]any {
		out := map[string]any{"sprintId": f.active.ID}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	f.doneStory = e.newIssue(f.owner, "GB", "story", "Done story", with(map[string]any{"storyPoints": 3, "statusId": done.ID}))
	f.doneStorySub = e.newIssue(f.owner, "GB", "subtask", "Open subtask of done story", map[string]any{"parentId": f.doneStory.ID})
	f.openStory = e.newIssue(f.owner, "GB", "story", "Open story", with(map[string]any{"storyPoints": 8, "statusId": inProgress.ID}))
	f.openStorySub = e.newIssue(f.owner, "GB", "subtask", "Done subtask of open story", map[string]any{"parentId": f.openStory.ID, "statusId": done.ID})
	f.openBug = e.newIssue(f.owner, "GB", "bug", "Open bug", with(map[string]any{"storyPoints": 2}))
	f.doneTask = e.newIssue(f.owner, "GB", "task", "Done task", with(map[string]any{"storyPoints": 5, "statusId": done.ID}))
	f.backlogIt = e.newIssue(f.owner, "GB", "task", "Backlog task", nil)
	f.active = e.startSprint(f.owner, f.active.ID, "2026-09-14", "2026-09-27")
	return f
}

func TestSprintStatistics(t *testing.T) {
	e := newTestEnv(t)
	f := newSprintFixture(e)
	// Subtasks and non-sprint issues are not counted; unestimated issues count as 0 points.
	got := e.getSprint(f.owner, f.active.ID)
	if got.IssueCount != 4 || got.PointsTotal != 18 || got.PointsDone != 8 {
		t.Fatalf("statistics: count=%d total=%v done=%v", got.IssueCount, got.PointsTotal, got.PointsDone)
	}
	e.newIssue(f.owner, "GB", "task", "Unestimated", map[string]any{"sprintId": f.active.ID})
	if got := e.getSprint(f.owner, f.active.ID); got.IssueCount != 5 || got.PointsTotal != 18 {
		t.Fatalf("after unestimated issue: %+v", got)
	}
	if list := e.listSprints(f.owner, "GB", ""); len(list) != 1 || list[0].IssueCount != 5 || list[0].PointsDone != 8 {
		t.Fatalf("list statistics: %+v", list)
	}
}

func TestSprintCompleteToBacklog(t *testing.T) {
	e := newTestEnv(t)
	f := newSprintFixture(e)
	u := f.owner
	sub := e.hub.Subscribe(e.getSprint(u, f.active.ID).ProjectID)
	defer e.hub.Unsubscribe(sub)

	res := e.completeSprint(u, f.active.ID, map[string]any{"target": "backlog"})
	if res.Sprint.State != "completed" || res.Sprint.CompletedAt == nil || res.TargetSprint != nil ||
		res.CompletedIssueCount != 2 || res.MovedIssueCount != 2 {
		t.Fatalf("result: %+v", res)
	}
	// The completed sprint keeps only its done issues.
	if res.Sprint.IssueCount != 2 || res.Sprint.PointsTotal != 8 || res.Sprint.PointsDone != 8 {
		t.Fatalf("completed sprint statistics: %+v", res.Sprint)
	}
	// Done issues stay (with their subtasks, even open ones); open issues move with theirs.
	for _, c := range []struct {
		issue  dto.IssueDetail
		sprint int64
	}{
		{f.doneStory, f.active.ID}, {f.doneStorySub, f.active.ID}, {f.doneTask, f.active.ID},
		{f.openStory, 0}, {f.openStorySub, 0}, {f.openBug, 0}, {f.backlogIt, 0},
	} {
		if got := sprintIDOf(e.getIssue(u, c.issue.Key).Issue); got != c.sprint {
			t.Errorf("%s (%s): sprint %d, want %d", c.issue.Key, c.issue.Summary, got, c.sprint)
		}
	}
	// Every moved issue has a sprint history row; the completion is logged last.
	for _, key := range []string{f.openStory.Key, f.openStorySub.Key, f.openBug.Key} {
		h := activitiesFor(e.issueActivity(u, key), "issue.updated", "sprint")
		if len(h) == 0 || deref(h[0].OldValue) != f.active.Name || h[0].NewValue != nil {
			t.Errorf("%s sprint history: %+v", key, h)
		}
	}
	if n := len(activitiesFor(e.issueActivity(u, f.doneStorySub.Key), "issue.updated", "sprint")); n != 0 {
		t.Errorf("subtask of a done story was logged as moved (%d rows)", n)
	}
	acts := e.projectActivity(u, "GB")
	if acts[0].Action != "sprint.completed" || deref(acts[0].NewValue) != f.active.Name {
		t.Fatalf("latest activity: %+v", acts[0])
	}
	select {
	case ev := <-sub.C:
		if ev.Type != realtime.SprintChanged || ev.ProjectKey != "GB" || ev.IssueKey != nil {
			t.Fatalf("event: %+v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("no sprint.changed event")
	}

	// A completed sprint is read-only and cannot be completed, started or deleted again.
	expectError(t, e.do(http.MethodPost, sprintPath(f.active.ID, "/complete"), u.Token, nil), http.StatusConflict, "conflict")
	expectError(t, e.do(http.MethodDelete, sprintPath(f.active.ID, ""), u.Token, nil), http.StatusConflict, "conflict")
	// Issues cannot be put into it any more.
	expectFieldError(t, e.do(http.MethodPost, "/api/issues/"+f.openBug.Key+"/move", u.Token, map[string]any{"sprintId": f.active.ID}), "sprintId")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+f.openBug.Key, u.Token, map[string]any{"sprintId": f.active.ID}), "sprintId")
}

func TestSprintCompleteToExistingAndNewSprint(t *testing.T) {
	e := newTestEnv(t)
	f := newSprintFixture(e)
	u := f.owner
	next := e.createSprint(u, "GB", nil)
	complete := func(id int64, body any) *testResponse {
		return e.do(http.MethodPost, sprintPath(id, "/complete"), u.Token, body)
	}

	// Target validation.
	expectFieldError(t, complete(f.active.ID, map[string]any{"target": "moon"}), "target")
	expectFieldError(t, complete(f.active.ID, map[string]any{"target": "sprint"}), "sprintId")
	expectFieldError(t, complete(f.active.ID, map[string]any{"target": "sprint", "sprintId": f.active.ID}), "sprintId")
	expectFieldError(t, complete(f.active.ID, map[string]any{"target": "sprint", "sprintId": 999999}), "sprintId")
	other := e.createProject(u, "OPS")
	foreign := e.insertSprint(other.ID, "OPS Sprint 1", "planned")
	expectFieldError(t, complete(f.active.ID, map[string]any{"target": "sprint", "sprintId": foreign}), "sprintId")
	expectError(t, complete(next.ID, map[string]any{"target": "backlog"}), http.StatusConflict, "conflict")
	if s := e.getSprint(u, f.active.ID); s.State != "active" {
		t.Fatal("failed completions must not change the sprint")
	}

	// Into an existing planned sprint: open issues and their subtasks follow.
	res := e.completeSprint(u, f.active.ID, map[string]any{"target": "sprint", "sprintId": next.ID})
	if res.TargetSprint == nil || res.TargetSprint.ID != next.ID || res.TargetSprint.State != "planned" ||
		res.TargetSprint.IssueCount != 2 || res.TargetSprint.PointsTotal != 10 || res.MovedIssueCount != 2 {
		t.Fatalf("result: %+v target=%+v", res, res.TargetSprint)
	}
	for _, is := range []dto.IssueDetail{f.openStory, f.openStorySub, f.openBug} {
		if got := sprintIDOf(e.getIssue(u, is.Key).Issue); got != next.ID {
			t.Errorf("%s: sprint %d, want %d", is.Key, got, next.ID)
		}
	}
	if h := activitiesFor(e.issueActivity(u, f.openBug.Key), "issue.updated", "sprint"); deref(h[0].NewValue) != next.Name {
		t.Fatalf("bug history: %+v", h)
	}

	// Into a new sprint created on the fly (default name, sprint.created logged).
	e.startSprint(u, next.ID, "2026-09-28", "2026-10-11")
	res = e.completeSprint(u, next.ID, map[string]any{"target": "new"})
	if res.TargetSprint == nil || res.TargetSprint.Name != "GB Sprint 3" || res.TargetSprint.State != "planned" ||
		res.TargetSprint.IssueCount != 2 || res.MovedIssueCount != 2 || res.CompletedIssueCount != 0 {
		t.Fatalf("new target: %+v target=%+v", res, res.TargetSprint)
	}
	if got := sprintIDOf(e.getIssue(u, f.openStorySub.Key).Issue); got != res.TargetSprint.ID {
		t.Fatalf("subtask did not follow into the new sprint: %d", got)
	}
	created := activitiesFor(e.projectActivity(u, "GB"), "sprint.created", "")
	if deref(created[0].NewValue) != "GB Sprint 3" {
		t.Fatalf("sprint.created for the new target: %+v", created)
	}
	if got := sprintNames(e.listSprints(u, "GB", "state=planned")); !slices.Equal(got, []string{"GB Sprint 3"}) {
		t.Fatalf("planned sprints: %v", got)
	}
}

func TestDeletePlannedSprintMovesIssuesToBacklog(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	planned := e.createSprint(u, "GB", nil)
	story := e.newIssue(u, "GB", "story", "Story", map[string]any{"sprintId": planned.ID})
	sub := e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": story.ID})
	task := e.newIssue(u, "GB", "task", "Task", map[string]any{"sprintId": planned.ID})

	expectStatus(t, e.do(http.MethodDelete, sprintPath(planned.ID, ""), u.Token, nil), http.StatusNoContent)
	expectError(t, e.do(http.MethodGet, sprintPath(planned.ID, ""), u.Token, nil), http.StatusNotFound, "not_found")
	for _, is := range []dto.IssueDetail{story, sub, task} {
		got := e.getIssue(u, is.Key)
		if got.Sprint != nil {
			t.Errorf("%s still in a sprint: %+v", is.Key, got.Sprint)
		}
		h := activitiesFor(e.issueActivity(u, is.Key), "issue.updated", "sprint")
		if len(h) != 1 || deref(h[0].OldValue) != planned.Name || h[0].NewValue != nil {
			t.Errorf("%s history: %+v", is.Key, h)
		}
	}
	if bl := e.backlog(u, "GB"); len(bl.Sprints) != 0 || len(bl.Backlog) != 2 {
		t.Fatalf("backlog after delete: %+v", bl)
	}

	// Only planned sprints can be deleted.
	active := e.createSprint(u, "GB", nil)
	e.startSprint(u, active.ID, "2026-10-01", "2026-10-14")
	expectError(t, e.do(http.MethodDelete, sprintPath(active.ID, ""), u.Token, nil), http.StatusConflict, "conflict")
	expectError(t, e.do(http.MethodDelete, sprintPath(999999, ""), u.Token, nil), http.StatusNotFound, "not_found")
}

// TestSprintCompletionRacesIssueWrites completes sprints while other requests keep putting
// issues into them. Sprint rows are share-locked by issue writes and locked for update by
// the completion, so every request either lands before the completion (and its open issue
// is carried over) or fails validation afterwards: no deadlocks, no 500s and no open issue
// stranded in a completed sprint.
func TestSprintCompletionRacesIssueWrites(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	p := e.createProject(u, "GB")
	for round := range 4 {
		sp := e.createSprint(u, "GB", nil)
		e.startSprint(u, sp.ID, "2026-10-01", "2026-10-14")
		var backlog []dto.IssueDetail
		for range 6 {
			backlog = append(backlog, e.newIssue(u, "GB", "story", "Backlog story", nil))
		}

		var wg sync.WaitGroup
		results := make(chan *testResponse, 64)
		for i := range 6 {
			wg.Add(3)
			go func() {
				defer wg.Done()
				results <- e.do(http.MethodPost, "/api/projects/GB/issues", u.Token, map[string]any{"type": "task", "summary": "Racing", "sprintId": sp.ID})
			}()
			go func() {
				defer wg.Done()
				results <- e.do(http.MethodPost, "/api/issues/"+backlog[i].Key+"/move", u.Token, map[string]any{"sprintId": sp.ID})
			}()
			go func() {
				defer wg.Done()
				results <- e.do(http.MethodPatch, "/api/issues/"+backlog[i].Key, u.Token, map[string]any{"sprintId": sp.ID, "summary": "Patched"})
			}()
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- e.do(http.MethodPost, sprintPath(sp.ID, "/complete"), u.Token, map[string]any{"target": "backlog"})
		}()
		wg.Wait()
		close(results)
		for res := range results {
			if res.Status >= 500 || (res.Status >= 400 && res.Status != http.StatusBadRequest) {
				t.Fatalf("round %d: unexpected %d: %s", round, res.Status, res.Body)
			}
		}
		var stranded int
		err := e.pool.QueryRow(context.Background(), `
			SELECT count(*) FROM issues i JOIN statuses s ON s.id = i.status_id
			WHERE i.project_id = $1 AND i.sprint_id = $2 AND s.category <> 'done'`, p.ID, sp.ID).Scan(&stranded)
		if err != nil {
			t.Fatal(err)
		}
		if stranded != 0 {
			t.Fatalf("round %d: %d open issues stranded in the completed sprint", round, stranded)
		}
	}
}
