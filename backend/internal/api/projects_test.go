package api

import (
	"fmt"
	"net/http"
	"testing"

	"geneboard/internal/dto"
)

func TestProjectCreateDefaults(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")

	p := decodeAs[dto.Project](t, e.do(http.MethodPost, "/api/projects", u.Token, map[string]any{
		"key": " gb ", "name": " Gene Board ", "description": "Tracker",
	}), http.StatusCreated)
	if p.Key != "GB" || p.Name != "Gene Board" || p.Description != "Tracker" || p.Type != "scrum" ||
		p.MyRole != "admin" || p.IssueCount != 0 || p.Lead == nil || p.Lead.ID != u.ID {
		t.Fatalf("unexpected project: %+v", p)
	}

	statuses := e.statuses(u, "GB")
	want := []struct {
		name, category string
	}{{"To Do", "todo"}, {"In Progress", "in_progress"}, {"In Review", "in_progress"}, {"Done", "done"}}
	if len(statuses) != len(want) {
		t.Fatalf("statuses: %+v", statuses)
	}
	for i, w := range want {
		s := statuses[i]
		if s.Name != w.name || s.Category != w.category || s.Position != i || s.WipLimit != nil {
			t.Errorf("status %d = %+v, want %s/%s", i, s, w.name, w.category)
		}
	}

	members := decodeAs[[]dto.Member](t, e.do(http.MethodGet, "/api/projects/gb/members", u.Token, nil), http.StatusOK)
	if len(members) != 1 || members[0].User.ID != u.ID || members[0].Role != "admin" {
		t.Fatalf("members: %+v", members)
	}

	act := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/projects/GB/activity", u.Token, nil), http.StatusOK)
	if len(act) != 1 || act[0].Action != "project.created" || deref(act[0].NewValue) != "Gene Board" || act[0].ProjectKey != "GB" {
		t.Fatalf("activity: %+v", act)
	}

	kanban := e.createProjectOfType(u, "OPS", "kanban")
	if kanban.Type != "kanban" {
		t.Fatalf("kanban: %+v", kanban)
	}

	// Case-insensitive lookup and list ordered by name.
	got := decodeAs[dto.Project](t, e.do(http.MethodGet, "/api/projects/Gb", u.Token, nil), http.StatusOK)
	if got.ID != p.ID {
		t.Fatalf("lookup: %+v", got)
	}
	list := decodeAs[[]dto.Project](t, e.do(http.MethodGet, "/api/projects", u.Token, nil), http.StatusOK)
	if len(list) != 2 || list[0].Key != "GB" || list[1].Key != "OPS" {
		t.Fatalf("list: %+v", list)
	}

	// Validation and conflicts.
	expectError(t, e.do(http.MethodPost, "/api/projects", u.Token, map[string]any{"key": "gb", "name": "Again"}), http.StatusConflict, "conflict")
	for _, key := range []string{"G", "1AB", "TOOLONGKEY1", "A-B", ""} {
		expectFieldError(t, e.do(http.MethodPost, "/api/projects", u.Token, map[string]any{"key": key, "name": "X"}), "key")
	}
	expectFieldError(t, e.do(http.MethodPost, "/api/projects", u.Token, map[string]any{"key": "OK", "name": ""}), "name")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects", u.Token, map[string]any{"key": "OK", "name": "X", "type": "waterfall"}), "type")
}

func TestProjectUpdateAndDelete(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	member := e.createUser("Member")
	outsider := e.createUser("Outsider")
	e.createProject(admin, "GB")
	e.addMember(admin, "GB", member, "member")

	p := decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/GB", admin.Token, map[string]any{
		"name": "Renamed", "description": "New", "type": "kanban", "leadId": member.ID,
	}), http.StatusOK)
	if p.Name != "Renamed" || p.Description != "New" || p.Type != "kanban" || p.Lead == nil || p.Lead.ID != member.ID {
		t.Fatalf("patched: %+v", p)
	}
	p = decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/GB", admin.Token, map[string]any{"leadId": nil, "description": nil}), http.StatusOK)
	if p.Lead != nil || p.Description != "" || p.Name != "Renamed" {
		t.Fatalf("cleared: %+v", p)
	}
	expectFieldError(t, e.do(http.MethodPatch, "/api/projects/GB", admin.Token, map[string]any{"leadId": outsider.ID}), "leadId")
	expectFieldError(t, e.do(http.MethodPatch, "/api/projects/GB", admin.Token, map[string]any{"name": nil}), "name")
	expectError(t, e.do(http.MethodPatch, "/api/projects/GB", member.Token, map[string]any{"name": "x"}), http.StatusForbidden, "forbidden")
	expectError(t, e.do(http.MethodDelete, "/api/projects/GB", member.Token, nil), http.StatusForbidden, "forbidden")

	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB", admin.Token, nil), http.StatusNoContent)
	expectError(t, e.do(http.MethodGet, "/api/projects/GB", admin.Token, nil), http.StatusNotFound, "not_found")
}

func TestProjectPermissions(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	viewer := e.createUser("Viewer")
	member := e.createUser("Member")
	outsider := e.createUser("Outsider")
	e.createProject(admin, "GB")
	e.addMember(admin, "GB", viewer, "viewer")
	e.addMember(admin, "GB", member, "member")
	issue := e.newIssue(admin, "GB", "task", "Secret task", nil)

	// Non-members: 404 for the project and everything inside it.
	for _, path := range []string{
		"/api/projects/GB", "/api/projects/GB/members", "/api/projects/GB/statuses", "/api/projects/GB/labels",
		"/api/projects/GB/activity", "/api/issues/" + issue.Key, "/api/issues/" + issue.Key + "/comments",
		"/api/issues/" + issue.Key + "/activity", "/api/issues?project=GB",
	} {
		expectError(t, e.do(http.MethodGet, path, outsider.Token, nil), http.StatusNotFound, "not_found")
	}
	expectError(t, e.do(http.MethodPatch, "/api/issues/"+issue.Key, outsider.Token, map[string]any{"summary": "x"}), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodPost, "/api/projects/GB/issues", outsider.Token, map[string]any{"type": "task", "summary": "x"}), http.StatusNotFound, "not_found")
	list := decodeAs[[]dto.Project](t, e.do(http.MethodGet, "/api/projects", outsider.Token, nil), http.StatusOK)
	if len(list) != 0 {
		t.Fatalf("outsider sees projects: %+v", list)
	}

	// Viewers can read but not write.
	decodeAs[dto.IssueDetail](t, e.do(http.MethodGet, "/api/issues/"+issue.Key, viewer.Token, nil), http.StatusOK)
	viewerWrites := []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/api/projects/GB/issues", map[string]any{"type": "task", "summary": "x"}},
		{http.MethodPatch, "/api/issues/" + issue.Key, map[string]any{"summary": "x"}},
		{http.MethodDelete, "/api/issues/" + issue.Key, nil},
		{http.MethodPost, "/api/issues/" + issue.Key + "/move", map[string]any{}},
		{http.MethodPost, "/api/issues/" + issue.Key + "/comments", map[string]any{"body": "hi"}},
		{http.MethodPost, "/api/issues/" + issue.Key + "/links", map[string]any{"type": "blocks", "targetKey": issue.Key}},
		{http.MethodPost, "/api/projects/GB/labels", map[string]any{"name": "x"}},
	}
	for _, w := range viewerWrites {
		expectError(t, e.do(w.method, w.path, viewer.Token, w.body), http.StatusForbidden, "forbidden")
	}

	// Members cannot use admin endpoints.
	adminOnly := []struct {
		method, path string
		body         any
	}{
		{http.MethodPatch, "/api/projects/GB", map[string]any{"name": "x"}},
		{http.MethodPost, "/api/projects/GB/members", map[string]any{"email": outsider.Email, "role": "member"}},
		{http.MethodPatch, fmt.Sprintf("/api/projects/GB/members/%d", viewer.ID), map[string]any{"role": "member"}},
		{http.MethodDelete, fmt.Sprintf("/api/projects/GB/members/%d", viewer.ID), nil},
		{http.MethodPost, "/api/projects/GB/statuses", map[string]any{"name": "QA", "category": "in_progress"}},
		{http.MethodPut, "/api/projects/GB/statuses/order", map[string]any{"statusIds": []int64{}}},
	}
	for _, a := range adminOnly {
		expectError(t, e.do(a.method, a.path, member.Token, a.body), http.StatusForbidden, "forbidden")
	}
	// ...but members can create labels and issues.
	e.createLabel(member, "GB", "frontend")
	e.newIssue(member, "GB", "bug", "Member bug", nil)
}

func TestMembers(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	bob := e.createUser("Bob")
	carol := e.createUser("Carol")
	e.createProject(admin, "GB")

	m := e.addMember(admin, "GB", bob, "member")
	if m.User.ID != bob.ID || m.Role != "member" || m.User.Email != bob.Email {
		t.Fatalf("member: %+v", m)
	}
	expectError(t, e.do(http.MethodPost, "/api/projects/GB/members", admin.Token, map[string]any{"email": bob.Email, "role": "viewer"}), http.StatusConflict, "conflict")
	expectError(t, e.do(http.MethodPost, "/api/projects/GB/members", admin.Token, map[string]any{"email": "ghost@example.test", "role": "member"}), http.StatusNotFound, "not_found")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/members", admin.Token, map[string]any{"email": carol.Email, "role": "owner"}), "role")

	members := decodeAs[[]dto.Member](t, e.do(http.MethodGet, "/api/projects/GB/members", bob.Token, nil), http.StatusOK)
	if len(members) != 2 || members[0].User.Name != "Admin" || members[1].User.Name != "Bob" {
		t.Fatalf("members ordered by name: %+v", members)
	}

	updated := decodeAs[dto.Member](t, e.do(http.MethodPatch, fmt.Sprintf("/api/projects/GB/members/%d", bob.ID), admin.Token, map[string]any{"role": "viewer"}), http.StatusOK)
	if updated.Role != "viewer" {
		t.Fatalf("role: %+v", updated)
	}
	expectError(t, e.do(http.MethodPatch, fmt.Sprintf("/api/projects/GB/members/%d", carol.ID), admin.Token, map[string]any{"role": "viewer"}), http.StatusNotFound, "not_found")

	act := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/projects/GB/activity", admin.Token, nil), http.StatusOK)
	added := activitiesFor(act, "member.added", "")
	if len(added) != 1 || deref(added[0].NewValue) != "Bob (member)" {
		t.Fatalf("member.added: %+v", added)
	}
}

func TestLastAdminProtection(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	other := e.createUser("Other")
	e.createProject(admin, "GB")
	e.addMember(admin, "GB", other, "member")
	adminPath := fmt.Sprintf("/api/projects/GB/members/%d", admin.ID)

	expectError(t, e.do(http.MethodPatch, adminPath, admin.Token, map[string]any{"role": "member"}), http.StatusConflict, "conflict")
	expectError(t, e.do(http.MethodDelete, adminPath, admin.Token, nil), http.StatusConflict, "conflict")

	// With a second admin, the first may step down and then leave.
	decodeAs[dto.Member](t, e.do(http.MethodPatch, fmt.Sprintf("/api/projects/GB/members/%d", other.ID), admin.Token, map[string]any{"role": "admin"}), http.StatusOK)
	decodeAs[dto.Member](t, e.do(http.MethodPatch, adminPath, admin.Token, map[string]any{"role": "member"}), http.StatusOK)
	expectError(t, e.do(http.MethodPatch, fmt.Sprintf("/api/projects/GB/members/%d", other.ID), other.Token, map[string]any{"role": "viewer"}), http.StatusConflict, "conflict")
	expectStatus(t, e.do(http.MethodDelete, adminPath, admin.Token, nil), http.StatusNoContent) // leave
	expectError(t, e.do(http.MethodGet, "/api/projects/GB", admin.Token, nil), http.StatusNotFound, "not_found")
}

func TestRemoveMemberUnassignsIssues(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	dev := e.createUser("Dev")
	e.createProject(admin, "GB")
	e.addMember(admin, "GB", dev, "member")
	decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/GB", admin.Token, map[string]any{"leadId": dev.ID}), http.StatusOK)
	issue := e.newIssue(admin, "GB", "task", "Assigned", map[string]any{"assigneeId": dev.ID})
	if issue.Assignee == nil || issue.Assignee.ID != dev.ID {
		t.Fatalf("assignee: %+v", issue.Assignee)
	}

	expectStatus(t, e.do(http.MethodDelete, fmt.Sprintf("/api/projects/GB/members/%d", dev.ID), admin.Token, nil), http.StatusNoContent)
	after := e.getIssue(admin, issue.Key)
	if after.Assignee != nil {
		t.Fatalf("issue still assigned: %+v", after.Assignee)
	}
	p := decodeAs[dto.Project](t, e.do(http.MethodGet, "/api/projects/GB", admin.Token, nil), http.StatusOK)
	if p.Lead != nil {
		t.Fatalf("removed member is still lead: %+v", p.Lead)
	}
	hist := activitiesFor(e.issueActivity(admin, issue.Key), "issue.updated", "assignee")
	if len(hist) != 1 || deref(hist[0].OldValue) != "Dev" || hist[0].NewValue != nil {
		t.Fatalf("assignee history: %+v", hist)
	}
	act := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/projects/GB/activity", admin.Token, nil), http.StatusOK)
	if removed := activitiesFor(act, "member.removed", ""); len(removed) != 1 || deref(removed[0].NewValue) != "Dev" {
		t.Fatalf("member.removed: %+v", removed)
	}
}
