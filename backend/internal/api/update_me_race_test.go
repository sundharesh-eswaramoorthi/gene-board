package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"geneboard/internal/dto"
)

// Deterministic races on PATCH /auth/me (see "deterministic races" in concurrency_test.go):
// a side transaction row-locks the user, so the requests started meanwhile have read the
// account (and done their bcrypt work) and queue on the lock in a known order.

// lockUser row-locks u's account in a side transaction, standing in for a write in flight.
func (e *testEnv) lockUser(u testUser) func() {
	tx := e.sideTx()
	e.sideExec(tx, `SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE`, u.ID)
	return func() { e.sideCommit(tx) }
}

// expectLogin asserts whether u's e-mail signs in with password.
func (e *testEnv) expectLogin(u testUser, password string, want int) {
	e.t.Helper()
	res := e.do(http.MethodPost, "/api/auth/login", "", map[string]any{"email": u.Email, "password": password})
	if res.Status != want {
		e.t.Fatalf("login with %q: status %d, want %d; body: %s", password, res.Status, want, res.Body)
	}
}

// TestRenameDoesNotRevertPasswordChange: a rename that read the account before a password
// change committed, and writes after it, used to write the old password hash back — the
// change answered 200 and revoked the old sessions, yet the old password kept working and
// the new one was rejected. Later it answered 200 with a token at the new token version,
// so the session the change had revoked survived it. The change revoked the rename's
// token, so the rename now writes nothing and answers 401.
func TestRenameDoesNotRevertPasswordChange(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Ann")

	release := e.lockUser(u)
	change := e.async(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"currentPassword": testPassword, "newPassword": "a-new-password"})
	e.waitForLockWaiters(1)
	rename := e.async(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"name": "Ann Renamed"})
	e.waitForLockWaiters(2)
	release()

	changed := decodeAs[dto.AuthResponse](t, <-change, http.StatusOK)
	expectError(t, <-rename, http.StatusUnauthorized, "unauthorized")
	e.expectLogin(u, "a-new-password", http.StatusOK)
	e.expectLogin(u, testPassword, http.StatusUnauthorized)
	me := decodeAs[dto.User](t, e.do(http.MethodGet, "/api/auth/me", changed.Token, nil), http.StatusOK)
	if me.Name != "Ann" {
		t.Fatalf("name = %q, want it unchanged", me.Name)
	}
	// The change still revoked the tokens issued before it.
	expectError(t, e.do(http.MethodGet, "/api/auth/me", u.Token, nil), http.StatusUnauthorized, "unauthorized")
}

// TestUpdateMeCannotOutliveAPasswordChange: whoever holds a session (e.g. a stolen token)
// must not keep one past a password change by sending account updates while it happens.
// Updates other than a password change return the caller's own token, which the change
// revokes; one whose write lands after the change answers 401. Unstaged, the attacker
// floods renames and no-op updates around the change.
func TestUpdateMeCannotOutliveAPasswordChange(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Dan")
	nextTokenSecond()

	for _, body := range []map[string]any{{}, {"name": "Dan Renamed"}} {
		res := decodeAs[dto.AuthResponse](t, e.do(http.MethodPatch, "/api/auth/me", u.Token, body), http.StatusOK)
		if res.Token != u.Token {
			t.Fatalf("PATCH %v returned a new token: only a password change starts a new session", body)
		}
	}

	stop := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	tokens := map[string]bool{}
	for i := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; ; n++ {
				select {
				case <-stop:
					return
				default:
				}
				body := map[string]any{}
				if i%2 == 1 {
					body["name"] = fmt.Sprintf("Dan %d-%d", i, n)
				}
				res := e.do(http.MethodPatch, "/api/auth/me", u.Token, body)
				if res.Status != http.StatusOK {
					return // revoked
				}
				var ar dto.AuthResponse
				if err := json.Unmarshal(res.Body, &ar); err == nil {
					mu.Lock()
					tokens[ar.Token] = true
					mu.Unlock()
				}
			}
		}()
	}
	time.Sleep(20 * time.Millisecond)
	changed := decodeAs[dto.AuthResponse](t, e.do(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"currentPassword": testPassword, "newPassword": "a-new-password"}), http.StatusOK)
	time.Sleep(20 * time.Millisecond)
	close(stop)
	wg.Wait()

	for tok := range tokens {
		expectError(t, e.do(http.MethodGet, "/api/auth/me", tok, nil), http.StatusUnauthorized, "unauthorized")
	}
	expectStatus(t, e.do(http.MethodGet, "/api/auth/me", changed.Token, nil), http.StatusOK)
}

// TestPasswordChangeDoesNotRevertRename: a password change spends ~0.5 s in bcrypt between
// reading the account and writing it; a rename committed meanwhile used to be overwritten
// with the name it had read.
func TestPasswordChangeDoesNotRevertRename(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Ben")

	release := e.lockUser(u)
	rename := e.async(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"name": "Ben Renamed"})
	e.waitForLockWaiters(1)
	change := e.async(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"currentPassword": testPassword, "newPassword": "a-new-password"})
	e.waitForLockWaiters(2)
	release()

	decodeAs[dto.AuthResponse](t, <-rename, http.StatusOK)
	changed := decodeAs[dto.AuthResponse](t, <-change, http.StatusOK)
	if changed.User.Name != "Ben Renamed" {
		t.Fatalf("password change answered name %q, want the rename", changed.User.Name)
	}
	me := decodeAs[dto.User](t, e.do(http.MethodGet, "/api/auth/me", changed.Token, nil), http.StatusOK)
	if me.Name != "Ben Renamed" {
		t.Fatalf("name = %q, want the rename", me.Name)
	}
	e.expectLogin(u, "a-new-password", http.StatusOK)
}

// TestConcurrentPasswordChanges: two password changes verified against the same current
// password used to both answer 200 while only the last one took effect (and the first
// caller's new token was already revoked). The second one is now a 409.
func TestConcurrentPasswordChanges(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Cat")

	release := e.lockUser(u)
	first := e.async(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"currentPassword": testPassword, "newPassword": "first-password"})
	e.waitForLockWaiters(1)
	second := e.async(http.MethodPatch, "/api/auth/me", u.Token, map[string]any{"currentPassword": testPassword, "newPassword": "second-password", "name": "Cat Second"})
	e.waitForLockWaiters(2)
	release()

	won := decodeAs[dto.AuthResponse](t, <-first, http.StatusOK)
	expectError(t, <-second, http.StatusConflict, "conflict")
	e.expectLogin(u, "first-password", http.StatusOK)
	e.expectLogin(u, "second-password", http.StatusUnauthorized)
	e.expectLogin(u, testPassword, http.StatusUnauthorized)
	// The losing request changed nothing, not even the name it carried.
	me := decodeAs[dto.User](t, e.do(http.MethodGet, "/api/auth/me", won.Token, nil), http.StatusOK)
	if me.Name != "Cat" {
		t.Fatalf("name = %q, want it unchanged", me.Name)
	}
}
