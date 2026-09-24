package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"geneboard/internal/dto"
)

// These tests hold a row change in a side transaction (see sideTx), start a request that
// must wait for it, then commit the side transaction.

// waitUntilBlocked waits until a request started with async is blocked on a lock. It fails
// the test at once if the request finishes instead (it did not wait for the side transaction).
func (e *testEnv) waitUntilBlocked(res <-chan *testResponse) {
	e.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		select {
		case r := <-res:
			e.t.Fatalf("request finished without waiting for the side transaction: %d %s", r.Status, r.Body)
		default:
		}
		var waiting int
		err := e.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&waiting)
		if err != nil {
			e.t.Fatalf("read pg_stat_activity: %v", err)
		}
		if waiting > 0 {
			return
		}
		if time.Now().After(deadline) {
			e.t.Fatal("timed out waiting for the request to block")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// TestConcurrentReverseRelatesLinkIsDuplicate: "relates" is symmetric, so linking B relates A
// while A relates B is being created is a duplicate (409), not a second link.
func TestConcurrentReverseRelatesLinkIsDuplicate(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	a := e.newIssue(u, "GB", "task", "A", nil)
	b := e.newIssue(u, "GB", "task", "B", nil)

	tx := e.sideTx() // B relates A, not committed yet: the duplicate check cannot see it
	e.sideExec(tx, `INSERT INTO issue_links (type, source_id, target_id) VALUES ('relates', $1, $2)`, b.ID, a.ID)
	res := e.async(http.MethodPost, "/api/issues/"+a.Key+"/links", u.Token, map[string]any{"type": "relates", "targetKey": b.Key})
	e.waitUntilBlocked(res)
	e.sideCommit(tx)
	expectError(t, <-res, http.StatusConflict, "conflict")

	if links := e.getIssue(u, a.Key).Links; len(links) != 1 || links[0].Direction != "inward" || links[0].Issue.Key != b.Key {
		t.Fatalf("A links: %+v", links)
	}
	if got := activitiesFor(e.issueActivity(u, a.Key), "link.created", ""); len(got) != 0 {
		t.Fatalf("the refused link was logged: %+v", got)
	}
}

// TestConcurrentLinkDeletesLogOnce: of two deletes of one link, the one that finds it gone
// answers 404 and logs nothing (the history shows one removal).
func TestConcurrentLinkDeletesLogOnce(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	a := e.newIssue(u, "GB", "task", "A", nil)
	b := e.newIssue(u, "GB", "task", "B", nil)
	link := decodeAs[dto.IssueLink](t, e.do(http.MethodPost, "/api/issues/"+a.Key+"/links", u.Token,
		map[string]any{"type": "blocks", "targetKey": b.Key}), http.StatusCreated)

	tx := e.sideTx() // the other delete, not committed yet
	e.sideExec(tx, `DELETE FROM issue_links WHERE id = $1`, link.ID)
	res := e.async(http.MethodDelete, "/api/issue-links/"+itoa(link.ID), u.Token, nil)
	e.waitUntilBlocked(res)
	e.sideCommit(tx)
	expectError(t, <-res, http.StatusNotFound, "not_found")

	if got := activitiesFor(e.issueActivity(u, a.Key), "link.deleted", ""); len(got) != 0 {
		t.Fatalf("the losing delete was logged: %+v", got)
	}
}

// TestCommentEditRacingDeleteIsNotFound: saving an edit to a comment that is being deleted
// (itself, or with its issue) answers 404 once the delete commits, never a 500.
func TestCommentEditRacingDeleteIsNotFound(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	comment := func(issueKey string) dto.Comment {
		t.Helper()
		return decodeAs[dto.Comment](t, e.do(http.MethodPost, "/api/issues/"+issueKey+"/comments", u.Token,
			map[string]any{"body": "Original"}), http.StatusCreated)
	}
	race := func(deleteSQL string, id int64, c dto.Comment) *testResponse {
		t.Helper()
		tx := e.sideTx()
		e.sideExec(tx, deleteSQL, id)
		res := e.async(http.MethodPatch, "/api/comments/"+itoa(c.ID), u.Token, map[string]any{"body": "Edited"})
		e.waitUntilBlocked(res)
		e.sideCommit(tx)
		return <-res
	}

	x := e.newIssue(u, "GB", "task", "X", nil)
	c := comment(x.Key)
	expectError(t, race(`DELETE FROM comments WHERE id = $1`, c.ID, c), http.StatusNotFound, "not_found")

	gone := e.newIssue(u, "GB", "task", "Gone", nil)
	c = comment(gone.Key)
	expectError(t, race(`DELETE FROM issues WHERE id = $1`, gone.ID, c), http.StatusNotFound, "not_found")
}

// TestConcurrentLabelEditsKeepBothChanges: renaming a label while another admin recolours it
// keeps both changes (a PATCH leaves the fields it does not send unchanged, SPEC §5).
func TestConcurrentLabelEditsKeepBothChanges(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	l := e.createLabel(u, "GB", "backend")

	tx := e.sideTx() // the recolour, not committed yet
	e.sideExec(tx, `UPDATE labels SET color = '#FF0000' WHERE id = $1`, l.ID)
	res := e.async(http.MethodPatch, "/api/projects/GB/labels/"+itoa(l.ID), u.Token, map[string]any{"name": "api"})
	e.waitUntilBlocked(res)
	e.sideCommit(tx)
	if got := decodeAs[dto.Label](t, <-res, http.StatusOK); got.Name != "api" || got.Color != "#FF0000" {
		t.Fatalf("PATCH answered %+v, want api / #FF0000", got)
	}
	labels := decodeAs[[]dto.Label](t, e.do(http.MethodGet, "/api/projects/GB/labels", u.Token, nil), http.StatusOK)
	if len(labels) != 1 || labels[0].Name != "api" || labels[0].Color != "#FF0000" {
		t.Fatalf("labels: %+v", labels)
	}
}
