package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"geneboard/internal/dto"
	"geneboard/internal/realtime"
)

func TestComments(t *testing.T) {
	e := newTestEnv(t)
	admin := e.createUser("Admin")
	alice := e.createUser("Alice")
	bob := e.createUser("Bob")
	viewer := e.createUser("Viewer")
	e.createProject(admin, "GB")
	e.addMember(admin, "GB", alice, "member")
	e.addMember(admin, "GB", bob, "member")
	e.addMember(admin, "GB", viewer, "viewer")
	issue := e.newIssue(admin, "GB", "task", "Discuss", nil)
	commentsPath := "/api/issues/" + issue.Key + "/comments"

	long := strings.Repeat("é", 250)
	c1 := decodeAs[dto.Comment](t, e.do(http.MethodPost, commentsPath, alice.Token, map[string]any{"body": "  " + long + "  "}), http.StatusCreated)
	if c1.Body != long || c1.Author == nil || c1.Author.ID != alice.ID || c1.Edited || c1.IssueID != issue.ID {
		t.Fatalf("comment: %+v", c1)
	}
	c2 := decodeAs[dto.Comment](t, e.do(http.MethodPost, commentsPath, bob.Token, map[string]any{"body": "Second"}), http.StatusCreated)
	expectFieldError(t, e.do(http.MethodPost, commentsPath, alice.Token, map[string]any{"body": "   "}), "body")
	expectFieldError(t, e.do(http.MethodPost, commentsPath, alice.Token, map[string]any{"body": strings.Repeat("x", 10001)}), "body")
	expectError(t, e.do(http.MethodPost, commentsPath, viewer.Token, map[string]any{"body": "hi"}), http.StatusForbidden, "forbidden")

	list := decodeAs[[]dto.Comment](t, e.do(http.MethodGet, commentsPath, viewer.Token, nil), http.StatusOK)
	if len(list) != 2 || list[0].ID != c1.ID || list[1].ID != c2.ID {
		t.Fatalf("list (oldest first): %+v", list)
	}

	// Author-only edit.
	c1Path := "/api/comments/" + itoa(c1.ID)
	expectError(t, e.do(http.MethodPatch, c1Path, bob.Token, map[string]any{"body": "hijack"}), http.StatusForbidden, "forbidden")
	expectError(t, e.do(http.MethodPatch, c1Path, admin.Token, map[string]any{"body": "hijack"}), http.StatusForbidden, "forbidden")
	time.Sleep(5 * time.Millisecond)
	edited := decodeAs[dto.Comment](t, e.do(http.MethodPatch, c1Path, alice.Token, map[string]any{"body": "Edited"}), http.StatusOK)
	if edited.Body != "Edited" || !edited.Edited || !edited.UpdatedAt.After(edited.CreatedAt.Time) {
		t.Fatalf("edited: %+v", edited)
	}

	// Delete: author or admin only; outsiders get 404.
	outsider := e.createUser("Outsider")
	expectError(t, e.do(http.MethodDelete, c1Path, outsider.Token, nil), http.StatusNotFound, "not_found")
	expectError(t, e.do(http.MethodDelete, c1Path, bob.Token, nil), http.StatusForbidden, "forbidden")
	expectStatus(t, e.do(http.MethodDelete, c1Path, alice.Token, nil), http.StatusNoContent)
	expectStatus(t, e.do(http.MethodDelete, "/api/comments/"+itoa(c2.ID), admin.Token, nil), http.StatusNoContent)
	expectError(t, e.do(http.MethodDelete, c1Path, alice.Token, nil), http.StatusNotFound, "not_found")

	act := activitiesFor(e.issueActivity(admin, issue.Key), "comment.created", "")
	if len(act) != 2 || len([]rune(deref(act[1].NewValue))) != 200 || deref(act[0].NewValue) != "Second" {
		t.Fatalf("comment.created activity: %+v", act)
	}
}

func TestLinks(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	other := e.createUser("Other")
	e.createProject(u, "GB")
	e.createProject(u, "OPS")
	e.createProject(other, "SEC")
	a := e.newIssue(u, "GB", "task", "A", nil)
	b := e.newIssue(u, "GB", "bug", "B", nil)
	ops := e.newIssue(u, "OPS", "task", "Ops", nil)
	secret := e.newIssue(other, "SEC", "task", "Secret", nil)
	linksPath := "/api/issues/" + a.Key + "/links"

	l := decodeAs[dto.IssueLink](t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "blocks", "targetKey": strings.ToLower(b.Key)}), http.StatusCreated)
	if l.Type != "blocks" || l.Direction != "outward" || l.Label != "blocks" || l.Issue.Key != b.Key || l.Issue.Status.Name != "To Do" {
		t.Fatalf("link: %+v", l)
	}
	aLinks := e.getIssue(u, a.Key).Links
	bLinks := e.getIssue(u, b.Key).Links
	if len(aLinks) != 1 || aLinks[0].Direction != "outward" || aLinks[0].Issue.Key != b.Key {
		t.Fatalf("A links: %+v", aLinks)
	}
	if len(bLinks) != 1 || bLinks[0].Direction != "inward" || bLinks[0].Label != "is blocked by" || bLinks[0].Issue.Key != a.Key {
		t.Fatalf("B links: %+v", bLinks)
	}

	expectError(t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "blocks", "targetKey": b.Key}), http.StatusConflict, "conflict")
	decodeAs[dto.IssueLink](t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "relates", "targetKey": b.Key}), http.StatusCreated)
	expectError(t, e.do(http.MethodPost, "/api/issues/"+b.Key+"/links", u.Token, map[string]any{"type": "relates", "targetKey": a.Key}), http.StatusConflict, "conflict")
	expectFieldError(t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "blocks", "targetKey": a.Key}), "targetKey")
	expectFieldError(t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "blocks", "targetKey": "GB-999"}), "targetKey")
	expectFieldError(t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "blocks", "targetKey": secret.Key}), "targetKey")
	expectFieldError(t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "causes", "targetKey": b.Key}), "type")

	// Cross-project links work when the caller can see both issues.
	cross := decodeAs[dto.IssueLink](t, e.do(http.MethodPost, linksPath, u.Token, map[string]any{"type": "duplicates", "targetKey": ops.Key}), http.StatusCreated)
	opsLinks := e.getIssue(u, ops.Key).Links
	if len(opsLinks) != 1 || opsLinks[0].Label != "is duplicated by" || cross.Label != "duplicates" {
		t.Fatalf("cross-project links: %+v", opsLinks)
	}
	// Links to issues the viewer cannot access are hidden.
	e.addMember(u, "GB", other, "viewer")
	if got := e.getIssue(other, a.Key).Links; len(got) != 2 {
		t.Fatalf("viewer without OPS access should see 2 links, got %+v", got)
	}

	expectError(t, e.do(http.MethodDelete, "/api/issue-links/"+itoa(l.ID), other.Token, nil), http.StatusForbidden, "forbidden")
	expectStatus(t, e.do(http.MethodDelete, "/api/issue-links/"+itoa(l.ID), u.Token, nil), http.StatusNoContent)
	expectError(t, e.do(http.MethodDelete, "/api/issue-links/"+itoa(l.ID), u.Token, nil), http.StatusNotFound, "not_found")

	act := e.issueActivity(u, a.Key)
	created := activitiesFor(act, "link.created", "")
	deleted := activitiesFor(act, "link.deleted", "")
	if len(created) != 3 || deref(created[2].NewValue) != "blocks "+b.Key || deref(created[1].NewValue) != "relates to "+b.Key {
		t.Fatalf("link.created: %+v", created)
	}
	if len(deleted) != 1 || deref(deleted[0].NewValue) != "blocks "+b.Key {
		t.Fatalf("link.deleted: %+v", deleted)
	}
}

func TestActivityEndpoints(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	outsider := e.createUser("Outsider")
	e.createProject(u, "GB")
	e.createProject(u, "OPS")
	e.createProject(outsider, "SEC")
	issue := e.newIssue(u, "GB", "task", "First", nil)
	e.patchIssue(u, issue.Key, map[string]any{"summary": "Second"})
	e.newIssue(u, "OPS", "task", "Ops task", nil)

	project := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/projects/GB/activity", u.Token, nil), http.StatusOK)
	if len(project) != 3 || project[0].Action != "issue.updated" || project[2].Action != "project.created" {
		t.Fatalf("project activity (newest first): %+v", project)
	}
	for _, a := range project {
		if a.ProjectKey != "GB" || a.Actor == nil || a.Actor.Name != "Owner" {
			t.Fatalf("activity row: %+v", a)
		}
	}
	paged := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/projects/GB/activity?limit=1&offset=1", u.Token, nil), http.StatusOK)
	if len(paged) != 1 || paged[0].ID != project[1].ID {
		t.Fatalf("paged: %+v", paged)
	}
	expectError(t, e.do(http.MethodGet, "/api/projects/GB/activity?limit=0", u.Token, nil), http.StatusBadRequest, "bad_request")

	feed := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/activity?limit=30", u.Token, nil), http.StatusOK)
	if len(feed) != 5 || feed[0].ProjectKey != "OPS" || deref(feed[0].IssueKey) != "OPS-1" {
		t.Fatalf("feed: %+v", feed)
	}
	for _, a := range feed {
		if a.ProjectKey == "SEC" {
			t.Fatal("feed leaks other projects")
		}
	}
	if f := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, "/api/activity?limit=2", u.Token, nil), http.StatusOK); len(f) != 2 {
		t.Fatalf("feed limit: %d", len(f))
	}
}

func TestRealtimeEventsPublishedAfterCommit(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	p := e.createProject(u, "GB")
	sub := e.hub.Subscribe(p.ID)
	defer e.hub.Unsubscribe(sub)

	next := func() realtime.Event {
		t.Helper()
		select {
		case ev := <-sub.C:
			return ev
		case <-time.After(time.Second):
			t.Fatal("no realtime event")
			return realtime.Event{}
		}
	}
	noEvent := func() {
		t.Helper()
		select {
		case ev := <-sub.C:
			t.Fatalf("unexpected event %+v", ev)
		default:
		}
	}

	issue := e.newIssue(u, "GB", "task", "Live", nil)
	if ev := next(); ev.Type != realtime.IssueCreated || ev.ProjectKey != "GB" || ev.IssueKey == nil || *ev.IssueKey != issue.Key || ev.ActorID != u.ID {
		t.Fatalf("created event: %+v", ev)
	}
	e.patchIssue(u, issue.Key, map[string]any{"summary": "Changed"})
	if ev := next(); ev.Type != realtime.IssueUpdated {
		t.Fatalf("updated event: %+v", ev)
	}
	e.moveIssue(u, issue.Key, map[string]any{"statusId": e.statusNamed(u, "GB", "Done").ID})
	if ev := next(); ev.Type != realtime.IssueMoved {
		t.Fatalf("moved event: %+v", ev)
	}
	decodeAs[dto.Comment](t, e.do(http.MethodPost, "/api/issues/"+issue.Key+"/comments", u.Token, map[string]any{"body": "hi"}), http.StatusCreated)
	if ev := next(); ev.Type != realtime.CommentChanged || *ev.IssueKey != issue.Key {
		t.Fatalf("comment event: %+v", ev)
	}
	e.createLabel(u, "GB", "live")
	if ev := next(); ev.Type != realtime.ProjectChanged || ev.IssueKey != nil {
		t.Fatalf("project event: %+v", ev)
	}

	// Failed or no-op mutations publish nothing.
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+issue.Key, u.Token, map[string]any{"summary": ""}), "summary")
	e.patchIssue(u, issue.Key, map[string]any{"summary": "Changed"})
	noEvent()

	expectStatus(t, e.do(http.MethodDelete, "/api/issues/"+issue.Key, u.Token, nil), http.StatusNoContent)
	if ev := next(); ev.Type != realtime.IssueDeleted || *ev.IssueKey != issue.Key {
		t.Fatalf("deleted event: %+v", ev)
	}
}
