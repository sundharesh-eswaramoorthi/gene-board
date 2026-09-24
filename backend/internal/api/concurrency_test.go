package api

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"geneboard/internal/dto"
)

// TestConcurrentIssueWritesDoNotDeadlock hammers a few issues with every kind of write at
// once. Row locks are FOR NO KEY UPDATE, so writers holding an issue lock can still insert
// activity rows, comments and links referencing the project or issue while other requests
// hold the project lock (moves, creates). Every request must succeed; a deadlock would
// surface as a 500.
func TestConcurrentIssueWritesDoNotDeadlock(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	sp := e.createSprint(u, "GB", nil)
	statuses := e.statuses(u, "GB")
	var keys []string
	var ids []int64
	for i := range 4 {
		is := e.newIssue(u, "GB", "story", fmt.Sprintf("Story %d", i), nil)
		keys, ids = append(keys, is.Key), append(ids, is.ID)
		e.newIssue(u, "GB", "subtask", "Sub", map[string]any{"parentId": is.ID})
	}

	var wg sync.WaitGroup
	results := make(chan *testResponse, 256)
	run := func(method, path string, body any) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- e.do(method, path, u.Token, body)
		}()
	}
	for round := range 6 {
		for i, key := range keys {
			other := ids[(i+1)%len(ids)]
			status := statuses[(round+i)%len(statuses)].ID
			run(http.MethodPost, "/api/issues/"+key+"/move", map[string]any{"statusId": status, "prevIssueId": other})
			run(http.MethodPatch, "/api/issues/"+key, map[string]any{"summary": fmt.Sprintf("Story %d r%d", i, round), "sprintId": sp.ID})
			run(http.MethodPost, "/api/issues/"+key+"/comments", map[string]any{"body": "Concurrent comment"})
			run(http.MethodPost, "/api/projects/GB/issues", map[string]any{"type": "subtask", "summary": "New sub", "parentId": ids[i]})
		}
		run(http.MethodPost, "/api/issues/"+keys[0]+"/links", map[string]any{"type": "relates", "targetKey": keys[round%3+1]})
	}
	wg.Wait()
	close(results)
	for res := range results {
		// Links may legitimately conflict (409) when the same pair is linked twice.
		if res.Status >= 500 || (res.Status >= 400 && res.Status != http.StatusConflict) {
			t.Fatalf("unexpected %d: %s", res.Status, res.Body)
		}
	}
	// Ranks stayed unique and every subtask followed its parent into the sprint.
	e.rankedKeys(u, "GB")
	for _, key := range keys {
		detail := e.getIssue(u, key)
		for _, child := range detail.Children {
			if sprintIDOf(child) != sprintIDOf(detail.Issue) {
				t.Fatalf("%s: subtask %s in sprint %d, parent in %d", key, child.Key, sprintIDOf(child), sprintIDOf(detail.Issue))
			}
		}
	}
}

// TestStatusDeleteRacesIssueWrites deletes columns while other requests move issues into
// them. Issue writes key-share-lock the target status and DeleteStatus locks it for update
// before moving its issues, so each write either lands before the delete (and its issue is
// moved to moveTo) or finds the status gone (400 on statusId) — never a foreign-key 500.
func TestStatusDeleteRacesIssueWrites(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	todo := e.statusNamed(u, "GB", "To Do")
	var keys []string
	for i := range 6 {
		keys = append(keys, e.newIssue(u, "GB", "task", fmt.Sprintf("Task %d", i), nil).Key)
	}

	for round := range 8 {
		col := decodeAs[dto.Status](t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token,
			map[string]any{"name": fmt.Sprintf("Temp %d", round), "category": "in_progress"}), http.StatusCreated)

		var wg sync.WaitGroup
		results := make(chan *testResponse, 2*len(keys)+1)
		for i, key := range keys {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if i%2 == 0 {
					results <- e.do(http.MethodPatch, "/api/issues/"+key, u.Token, map[string]any{"statusId": col.ID})
				} else {
					results <- e.do(http.MethodPost, "/api/issues/"+key+"/move", u.Token, map[string]any{"statusId": col.ID})
				}
			}()
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- e.do(http.MethodDelete, fmt.Sprintf("/api/projects/GB/statuses/%d?moveTo=%d", col.ID, todo.ID), u.Token, nil)
		}()
		wg.Wait()
		close(results)
		for res := range results {
			switch {
			case res.Status < 300:
			case res.Status == http.StatusBadRequest:
				expectFieldError(t, res, "statusId")
			default:
				t.Fatalf("round %d: unexpected %d: %s", round, res.Status, res.Body)
			}
		}
		for _, s := range e.statuses(u, "GB") {
			if s.ID == col.ID {
				t.Fatalf("round %d: status %d survived its delete", round, col.ID)
			}
		}
		for _, key := range keys {
			if got := e.getIssue(u, key).Status.ID; got == col.ID {
				t.Fatalf("round %d: %s still in the deleted status", round, key)
			}
		}
	}
}

// --- deterministic races ---------------------------------------------------------------
//
// The tests below stage a race step by step: a side transaction (standing in for another
// request) takes a lock or makes an uncommitted change, the request under test is started
// in the background, the test waits until PostgreSQL reports it blocked on a lock, and only
// then lets the side transaction commit.

// sideTx begins a transaction on its own connection (rolled back at the end of the test
// unless committed).
func (e *testEnv) sideTx() pgx.Tx {
	e.t.Helper()
	ctx := context.Background()
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		e.t.Fatalf("begin side transaction: %v", err)
	}
	e.t.Cleanup(func() { _ = tx.Rollback(ctx) })
	return tx
}

// sideExec runs a statement in a side transaction.
func (e *testEnv) sideExec(tx pgx.Tx, sql string, args ...any) {
	e.t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatalf("side transaction %q: %v", sql, err)
	}
}

// sideCommit commits a side transaction.
func (e *testEnv) sideCommit(tx pgx.Tx) {
	e.t.Helper()
	if err := tx.Commit(context.Background()); err != nil {
		e.t.Fatalf("commit side transaction: %v", err)
	}
}

// async starts a request in the background; receive its response from the channel.
func (e *testEnv) async(method, path, token string, body any) <-chan *testResponse {
	ch := make(chan *testResponse, 1)
	go func() { ch <- e.do(method, path, token, body) }()
	return ch
}

// waitForLockWaiters waits until at least n sessions of the test database are blocked on
// a lock (i.e. the requests started with async have reached the contended row).
func (e *testEnv) waitForLockWaiters(n int) {
	e.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		var waiting int
		err := e.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&waiting)
		if err != nil {
			e.t.Fatalf("read pg_stat_activity: %v", err)
		}
		if waiting >= n {
			return
		}
		if time.Now().After(deadline) {
			e.t.Fatalf("timed out waiting for %d blocked request(s); %d blocked", n, waiting)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// TestSprintLifecycleSeesConcurrentStatusChanges (BL-1): the standard issues of a sprint
// being completed or deleted are row-locked; an issue whose status another transaction
// changes meanwhile must be re-read with its new status, not silently dropped (it would stay
// behind in the completed sprint, counted nowhere, and its sprint change would go unlogged).
// The side transaction changes the status without the project lock, which the API's own
// writers take, so this pins the query itself.
func TestSprintLifecycleSeesConcurrentStatusChanges(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	inProgress := e.statusNamed(u, "GB", "In Progress")

	active := e.createSprint(u, "GB", nil)
	x := e.newIssue(u, "GB", "story", "X", map[string]any{"sprintId": active.ID})
	y := e.newIssue(u, "GB", "story", "Y", map[string]any{"sprintId": active.ID})
	e.startSprint(u, active.ID, "2026-09-01", "2026-09-14")

	tx := e.sideTx()
	e.sideExec(tx, `UPDATE issues SET status_id = $1, updated_at = now() WHERE id = $2`, inProgress.ID, x.ID)
	complete := e.async(http.MethodPost, sprintPath(active.ID, "/complete"), u.Token, map[string]any{"target": "backlog"})
	e.waitForLockWaiters(1)
	e.sideCommit(tx)
	res := decodeAs[dto.CompleteSprintResult](t, <-complete, http.StatusOK)
	if res.CompletedIssueCount != 0 || res.MovedIssueCount != 2 {
		t.Fatalf("completed=%d moved=%d, want 0 and 2", res.CompletedIssueCount, res.MovedIssueCount)
	}
	for _, key := range []string{x.Key, y.Key} {
		if is := e.getIssue(u, key); is.Sprint != nil {
			t.Fatalf("%s (%s) stayed in %s", key, is.Status.Name, is.Sprint.Name)
		}
	}

	// Deleting a planned sprint moves (and logs) every issue, whatever its status.
	planned := e.createSprint(u, "GB", nil)
	z := e.newIssue(u, "GB", "story", "Z", map[string]any{"sprintId": planned.ID})
	sub := e.newIssue(u, "GB", "subtask", "Z sub", map[string]any{"parentId": z.ID})
	tx = e.sideTx()
	e.sideExec(tx, `UPDATE issues SET status_id = $1, updated_at = now() WHERE id = $2`, inProgress.ID, z.ID)
	del := e.async(http.MethodDelete, sprintPath(planned.ID, ""), u.Token, nil)
	e.waitForLockWaiters(1)
	e.sideCommit(tx)
	expectStatus(t, <-del, http.StatusNoContent)
	for _, key := range []string{z.Key, sub.Key} {
		changes := activitiesFor(e.issueActivity(u, key), "issue.updated", "sprint")
		if len(changes) == 0 || deref(changes[0].OldValue) != planned.Name || changes[0].NewValue != nil {
			t.Fatalf("%s: sprint change not logged: %+v", key, changes)
		}
	}
}

// TestStatusPatchRacesSprintCompletion (BL-1 through the API): a status PATCH arriving while
// the sprint completes is serialised with it, so the issue either counts as moved with its
// new status or was never re-statused — it never stays open in the completed sprint.
func TestStatusPatchRacesSprintCompletion(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	inProgress := e.statusNamed(u, "GB", "In Progress")
	sp := e.createSprint(u, "GB", nil)
	x := e.newIssue(u, "GB", "story", "X", map[string]any{"sprintId": sp.ID})
	e.newIssue(u, "GB", "story", "Y", map[string]any{"sprintId": sp.ID})
	e.startSprint(u, sp.ID, "2026-09-01", "2026-09-14")

	// A slow writer holds X, so the PATCH is still in flight when completion starts.
	tx := e.sideTx()
	e.sideExec(tx, `SELECT 1 FROM issues WHERE id = $1 FOR NO KEY UPDATE`, x.ID)
	patch := e.async(http.MethodPatch, "/api/issues/"+x.Key, u.Token, map[string]any{"statusId": inProgress.ID})
	e.waitForLockWaiters(1)
	complete := e.async(http.MethodPost, sprintPath(sp.ID, "/complete"), u.Token, map[string]any{"target": "backlog"})
	e.waitForLockWaiters(2)
	e.sideCommit(tx)

	expectStatus(t, <-patch, http.StatusOK)
	res := decodeAs[dto.CompleteSprintResult](t, <-complete, http.StatusOK)
	if res.CompletedIssueCount+res.MovedIssueCount != 2 || res.MovedIssueCount != 2 {
		t.Fatalf("completed=%d moved=%d, want 0 and 2", res.CompletedIssueCount, res.MovedIssueCount)
	}
	if is := e.getIssue(u, x.Key); is.Sprint != nil || is.Status.ID != inProgress.ID {
		t.Fatalf("X: status %s, sprint %v", is.Status.Name, is.Sprint)
	}
}

// TestReparentRacesSprintCompletion (BL-2): re-parenting a subtask onto an issue of the
// sprint being completed used to lock the subtask first and the new parent second — the
// reverse of completion's order — and deadlocked (500). Issue writes now take the project
// lock first, like sprint lifecycle changes.
func TestReparentRacesSprintCompletion(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	inReview := e.statusNamed(u, "GB", "In Review")
	sp := e.createSprint(u, "GB", nil)
	p1 := e.newIssue(u, "GB", "story", "P1", map[string]any{"sprintId": sp.ID})
	p2 := e.newIssue(u, "GB", "story", "P2", map[string]any{"sprintId": sp.ID})
	st := e.newIssue(u, "GB", "subtask", "ST", map[string]any{"parentId": p1.ID})
	e.startSprint(u, sp.ID, "2026-09-01", "2026-09-14")

	// Holding the target status makes the PATCH stop between locking the subtask and
	// share-locking its new parent — the window in which completion used to lock the parents.
	tx := e.sideTx()
	e.sideExec(tx, `SELECT 1 FROM statuses WHERE id = $1 FOR UPDATE`, inReview.ID)
	patch := e.async(http.MethodPatch, "/api/issues/"+st.Key, u.Token, map[string]any{"statusId": inReview.ID, "parentId": p2.ID})
	e.waitForLockWaiters(1)
	complete := e.async(http.MethodPost, sprintPath(sp.ID, "/complete"), u.Token, map[string]any{"target": "backlog"})
	e.waitForLockWaiters(2)
	e.sideCommit(tx)

	expectStatus(t, <-patch, http.StatusOK)
	res := decodeAs[dto.CompleteSprintResult](t, <-complete, http.StatusOK)
	if res.MovedIssueCount != 2 {
		t.Fatalf("moved = %d, want 2", res.MovedIssueCount)
	}
	got := e.getIssue(u, st.Key)
	if got.Parent == nil || got.Parent.ID != p2.ID || got.Sprint != nil {
		t.Fatalf("subtask: parent %v, sprint %v; want P2 and the backlog", got.Parent, got.Sprint)
	}
}

// TestProjectPatchRacesLeadRemoval (BL-5): PATCH /projects rewrites every column, so it must
// work from the locked, current row. Otherwise a description edit racing the removal of the
// lead writes the removed member back as lead.
func TestProjectPatchRacesLeadRemoval(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	dave := e.createUser("Dave")
	e.createProject(owner, "GB")
	e.addMember(owner, "GB", dave, "admin")
	decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/GB", owner.Token, map[string]any{"leadId": dave.ID}), http.StatusOK)

	tx := e.sideTx()
	e.sideExec(tx, `SELECT 1 FROM projects WHERE key = 'GB' FOR NO KEY UPDATE`)
	remove := e.async(http.MethodDelete, "/api/projects/GB/members/"+itoa(dave.ID), owner.Token, nil)
	e.waitForLockWaiters(1)
	patch := e.async(http.MethodPatch, "/api/projects/GB", owner.Token, map[string]any{"description": "new desc"})
	e.waitForLockWaiters(2)
	e.sideCommit(tx)

	expectStatus(t, <-remove, http.StatusNoContent)
	p := decodeAs[dto.Project](t, <-patch, http.StatusOK)
	if p.Description != "new desc" || p.Lead != nil {
		t.Fatalf("after PATCH: description %q, lead %v", p.Description, p.Lead)
	}
	if got := decodeAs[dto.Project](t, e.do(http.MethodGet, "/api/projects/GB", owner.Token, nil), http.StatusOK); got.Lead != nil {
		t.Fatalf("removed member %s is lead again", got.Lead.Name)
	}
}

// TestStatusCategoryChangeRacesIssueWrite (BL-6): an issue moved into a status while its
// category changes to done must end up resolved. The category change waits for in-flight
// issue writers (which hold the project lock), then re-derives resolvedAt for every issue
// in the status, including the one just moved in.
func TestStatusCategoryChangeRacesIssueWrite(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	inReview := e.statusNamed(u, "GB", "In Review")
	x := e.newIssue(u, "GB", "task", "X", nil)

	// An issue write in flight: it holds the project lock and has moved X into In Review
	// with the resolvedAt of In Review's old category (not done: null).
	tx := e.sideTx()
	e.sideExec(tx, `SELECT 1 FROM projects WHERE key = 'GB' FOR NO KEY UPDATE`)
	e.sideExec(tx, `UPDATE issues SET status_id = $1, resolved_at = NULL, updated_at = now() WHERE id = $2`, inReview.ID, x.ID)
	patch := e.async(http.MethodPatch, "/api/projects/GB/statuses/"+itoa(inReview.ID), u.Token, map[string]any{"category": "done"})
	e.waitForLockWaiters(1)
	e.sideCommit(tx)

	st := decodeAs[dto.Status](t, <-patch, http.StatusOK)
	if st.Category != "done" {
		t.Fatalf("category = %s", st.Category)
	}
	if got := e.getIssue(u, x.Key); got.Status.ID != inReview.ID || got.ResolvedAt == nil {
		t.Fatalf("X in %s (%s) with resolvedAt %v; want resolved", got.Status.Name, got.Status.Category, got.ResolvedAt)
	}
}

// TestWritesRacingDeletesAreClientErrors (BL-7): a write referencing a row that another
// transaction is deleting waits for the delete, then answers 404 / 400 — never a 500 from a
// foreign-key violation or an UPDATE that found no row.
func TestWritesRacingDeletesAreClientErrors(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	x := e.newIssue(u, "GB", "task", "X", nil)

	// race deletes a row in a side transaction, runs the request and returns its response.
	race := func(deleteSQL string, id int64, method, path string, body any) *testResponse {
		t.Helper()
		tx := e.sideTx()
		e.sideExec(tx, deleteSQL, id)
		res := e.async(method, path, u.Token, body)
		e.waitForLockWaiters(1)
		e.sideCommit(tx)
		return <-res
	}
	const deleteIssue = `DELETE FROM issues WHERE id = $1`
	const deleteLabel = `DELETE FROM labels WHERE id = $1`

	gone := e.newIssue(u, "GB", "task", "Gone", nil)
	expectError(t, race(deleteIssue, gone.ID, http.MethodPost, "/api/issues/"+gone.Key+"/comments", map[string]any{"body": "hi"}),
		http.StatusNotFound, "not_found")

	target := e.newIssue(u, "GB", "task", "Target", nil)
	expectFieldError(t, race(deleteIssue, target.ID, http.MethodPost, "/api/issues/"+x.Key+"/links",
		map[string]any{"type": "blocks", "targetKey": target.Key}), "targetKey")

	source := e.newIssue(u, "GB", "task", "Source", nil)
	expectError(t, race(deleteIssue, source.ID, http.MethodPost, "/api/issues/"+source.Key+"/links",
		map[string]any{"type": "blocks", "targetKey": x.Key}), http.StatusNotFound, "not_found")

	l1 := e.createLabel(u, "GB", "one")
	expectFieldError(t, race(deleteLabel, l1.ID, http.MethodPatch, "/api/issues/"+x.Key, map[string]any{"labelIds": []int64{l1.ID}}), "labelIds")
	l2 := e.createLabel(u, "GB", "two")
	expectFieldError(t, race(deleteLabel, l2.ID, http.MethodPost, "/api/projects/GB/issues",
		map[string]any{"type": "task", "summary": "New", "labelIds": []int64{l2.ID}}), "labelIds")
	l3 := e.createLabel(u, "GB", "three")
	expectError(t, race(deleteLabel, l3.ID, http.MethodPatch, "/api/projects/GB/labels/"+itoa(l3.ID), map[string]any{"name": "renamed"}),
		http.StatusNotFound, "not_found")

	col := decodeAs[dto.Status](t, e.do(http.MethodPost, "/api/projects/GB/statuses", u.Token,
		map[string]any{"name": "Temp", "category": "in_progress"}), http.StatusCreated)
	expectError(t, race(`DELETE FROM statuses WHERE id = $1`, col.ID, http.MethodPatch, "/api/projects/GB/statuses/"+itoa(col.ID),
		map[string]any{"name": "Renamed"}), http.StatusNotFound, "not_found")
}
