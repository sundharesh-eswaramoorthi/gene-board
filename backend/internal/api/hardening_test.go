package api

import (
	"bufio"
	"context"
	"fmt"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"geneboard/internal/dto"
)

// TestNULAndInvalidUTF8AreBadRequests (BL-3): PostgreSQL cannot store NUL characters
// (JSON "\u0000") nor compare invalid UTF-8 (%FF in a URL). Such input must be a 400, not a
// 500 from the database.
func TestNULAndInvalidUTF8AreBadRequests(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	issue := e.newIssue(u, "GB", "task", "Task", nil)
	const nul = "a\u0000b"

	for _, c := range []struct {
		method, path, field string
		body                map[string]any
	}{
		{http.MethodPost, "/api/projects/GB/issues", "summary", map[string]any{"type": "task", "summary": nul}},
		{http.MethodPost, "/api/projects/GB/issues", "description", map[string]any{"type": "task", "summary": "ok", "description": nul}},
		{http.MethodPatch, "/api/issues/" + issue.Key, "description", map[string]any{"description": nul}},
		{http.MethodPost, "/api/issues/" + issue.Key + "/comments", "body", map[string]any{"body": nul}},
		{http.MethodPost, "/api/issues/" + issue.Key + "/links", "targetKey", map[string]any{"type": "blocks", "targetKey": "GB-\u00001"}},
		{http.MethodPost, "/api/projects/GB/labels", "name", map[string]any{"name": nul}},
		{http.MethodPost, "/api/projects/GB/statuses", "name", map[string]any{"name": nul, "category": "todo"}},
		{http.MethodPost, "/api/projects/GB/sprints", "goal", map[string]any{"goal": nul}},
		{http.MethodPatch, "/api/projects/GB", "description", map[string]any{"description": nul}},
		{http.MethodPost, "/api/projects/GB/members", "email", map[string]any{"email": "x\u0000@example.test"}},
		{http.MethodPatch, "/api/auth/me", "name", map[string]any{"name": nul}},
		{http.MethodPost, "/api/auth/register", "name", map[string]any{"email": "nul@example.test", "name": nul, "password": "password123"}},
		{http.MethodPost, "/api/auth/register", "email", map[string]any{"email": "n\u0000l@example.test", "name": "N", "password": "password123"}},
	} {
		expectFieldError(t, e.do(c.method, c.path, u.Token, c.body), c.field)
	}
	// Login answers like any unknown account.
	expectError(t, e.do(http.MethodPost, "/api/auth/login", "", map[string]any{"email": "x\u0000@example.test", "password": "password123"}),
		http.StatusUnauthorized, "unauthorized")

	for _, path := range []string{
		"/api/issues?q=a%00b", "/api/issues?q=%FF", "/api/issues?project=G%00B",
		"/api/users?query=a%00", "/api/users?query=%FF", "/api/projects/G%00B", "/api/issues/GB-%FF",
	} {
		expectError(t, e.do(http.MethodGet, path, u.Token, nil), http.StatusBadRequest, "bad_request")
	}
}

// TestActivityOffsetBeyondInt32 (BL-4): any offset the handlers accept must reach the
// database intact (it used to wrap around int32 and fail with a 500, or silently restart
// at the first page).
func TestActivityOffsetBeyondInt32(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")
	for _, path := range []string{"/api/projects/GB/activity", "/api/activity"} {
		for _, offset := range []string{"3000000000", "4294967296"} {
			rows := decodeAs[[]dto.Activity](t, e.do(http.MethodGet, path+"?offset="+offset, u.Token, nil), http.StatusOK)
			if len(rows) != 0 {
				t.Fatalf("%s?offset=%s returned %d rows", path, offset, len(rows))
			}
		}
		expectError(t, e.do(http.MethodGet, path+"?offset=99999999999999999999", u.Token, nil), http.StatusBadRequest, "bad_request")
	}
}

// TestDescriptionLimits (SEC-2): issue descriptions are capped at 32767 characters and
// project descriptions at 4000, so list and board payloads stay bounded.
func TestDescriptionLimits(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	e.createProject(u, "GB")

	max := strings.Repeat("é", 32767) // characters, not bytes
	issue := e.newIssue(u, "GB", "task", "At the limit", map[string]any{"description": max})
	expectFieldError(t, e.do(http.MethodPost, "/api/projects/GB/issues", u.Token,
		map[string]any{"type": "task", "summary": "Too long", "description": max + "x"}), "description")
	expectFieldError(t, e.do(http.MethodPatch, "/api/issues/"+issue.Key, u.Token, map[string]any{"description": max + "x"}), "description")

	decodeAs[dto.Project](t, e.do(http.MethodPatch, "/api/projects/GB", u.Token, map[string]any{"description": strings.Repeat("d", 4000)}), http.StatusOK)
	expectFieldError(t, e.do(http.MethodPatch, "/api/projects/GB", u.Token, map[string]any{"description": strings.Repeat("d", 4001)}), "description")
	expectFieldError(t, e.do(http.MethodPost, "/api/projects", u.Token,
		map[string]any{"key": "LONG", "name": "Long", "description": strings.Repeat("d", 4001)}), "description")
}

// authRequest is a login/register request from the given peer address (RemoteAddr), with
// an optional X-Real-IP header.
func authRequest(h http.Handler, path, peer, realIP, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = peer
	if realIP != "" {
		req.Header.Set("X-Real-IP", realIP)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// loopbackProxies is the default TRUSTED_PROXIES outside container mode.
var loopbackProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("::1/128")}

// TestAuthThrottling (SEC-3): sign-in and registration are rate limited per client address,
// and failed logins per account, answering 429 rate_limited with Retry-After.
func TestAuthThrottling(t *testing.T) {
	e := newTestEnv(t)
	victim := e.createUser("Victim")
	h := NewRouter(Deps{Service: e.svc, Logger: discardLogger, CORSOrigins: []string{testCORSOrigin}, AuthRateLimit: 3, TrustedProxies: loopbackProxies})
	wrong := fmt.Sprintf(`{"email":%q,"password":"wrong-password"}`, victim.Email)

	// Per client address: 3 requests a minute, then 429.
	const attacker = "203.0.113.7:4000"
	for i := range 3 {
		if rec := authRequest(h, "/api/auth/login", attacker, "", wrong); rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	rec := authRequest(h, "/api/auth/login", attacker, "", wrong)
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"rate_limited"`) || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("4th attempt: %d %s (Retry-After %q)", rec.Code, rec.Body, rec.Header().Get("Retry-After"))
	}
	if rec := authRequest(h, "/api/auth/register", attacker, "", `{"email":"new@example.test","name":"New","password":"password123"}`); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("register shares the budget: %d", rec.Code)
	}
	// A public client cannot pick its own key with X-Real-IP...
	if rec := authRequest(h, "/api/auth/login", attacker, "198.51.100.1", wrong); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("spoofed X-Real-IP: %d", rec.Code)
	}
	// ...but a trusted reverse proxy reports the real client, which has its own budget.
	if rec := authRequest(h, "/api/auth/login", "127.0.0.1:5555", "198.51.100.1", wrong); rec.Code != http.StatusUnauthorized {
		t.Fatalf("proxied client: %d %s", rec.Code, rec.Body)
	}
	// A private-network peer is not a proxy unless TRUSTED_PROXIES says so: a host on the
	// LAN cannot rotate its key with X-Real-IP.
	const lanPeer = "192.168.1.20:4000"
	for i := range 3 {
		if rec := authRequest(h, "/api/auth/login", lanPeer, fmt.Sprintf("198.51.100.%d", i+10), wrong); rec.Code != http.StatusUnauthorized {
			t.Fatalf("LAN attempt %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	if rec := authRequest(h, "/api/auth/login", lanPeer, "198.51.100.99", wrong); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("LAN peer choosing its key: %d", rec.Code)
	}

	// Per account: failed logins from many addresses lock the account's logins for a while,
	// even with the right password; other accounts are unaffected.
	h = NewRouter(Deps{Service: e.svc, Logger: discardLogger, CORSOrigins: []string{testCORSOrigin}, AuthRateLimit: 1000})
	for i := range accountFailureBurst {
		if rec := authRequest(h, "/api/auth/login", fmt.Sprintf("203.0.113.%d:1", i+1), "", wrong); rec.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d: %d", i, rec.Code)
		}
	}
	right := fmt.Sprintf(`{"email":%q,"password":%q}`, strings.ToUpper(victim.Email), testPassword)
	if rec := authRequest(h, "/api/auth/login", "203.0.113.99:1", "", right); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("locked account: %d %s", rec.Code, rec.Body)
	}
	other := e.createUser("Other")
	if rec := authRequest(h, "/api/auth/login", "203.0.113.99:1", "", fmt.Sprintf(`{"email":%q,"password":%q}`, other.Email, testPassword)); rec.Code != http.StatusOK {
		t.Fatalf("other account: %d %s", rec.Code, rec.Body)
	}
}

// TestSuccessfulLoginClearsFailures: a user who mistyped a few times and then signed in
// starts over with a full failure budget.
func TestSuccessfulLoginClearsFailures(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Typo")
	h := NewRouter(Deps{Service: e.svc, Logger: discardLogger, AuthRateLimit: 1000})
	wrong := fmt.Sprintf(`{"email":%q,"password":"wrong-password"}`, u.Email)
	right := fmt.Sprintf(`{"email":%q,"password":%q}`, u.Email, testPassword)
	for range accountFailureBurst - 1 {
		authRequest(h, "/api/auth/login", "203.0.113.1:1", "", wrong)
	}
	if rec := authRequest(h, "/api/auth/login", "203.0.113.1:1", "", right); rec.Code != http.StatusOK {
		t.Fatalf("login: %d", rec.Code)
	}
	for i := range accountFailureBurst {
		if rec := authRequest(h, "/api/auth/login", "203.0.113.1:1", "", wrong); rec.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d after a successful login: %d", i, rec.Code)
		}
	}
}

// meRequest is a PATCH /auth/me request with token from the given peer address.
func meRequest(h http.Handler, peer, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, "/api/auth/me", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.RemoteAddr = peer
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestPasswordChangeThrottling: PATCH /auth/me verifies the current password when it changes
// the password, so it is throttled like a login — wrong current passwords per session, and
// requests per client address (sharing the sign-in budget) — or a stolen session could
// guess the password at bcrypt speed. Name-only updates are not throttled.
func TestPasswordChangeThrottling(t *testing.T) {
	e := newTestEnv(t)
	victim := e.createUser("Victim")
	other := e.createUser("Other")
	h := NewRouter(Deps{Service: e.svc, Logger: discardLogger, AuthRateLimit: 1000})
	guess := `{"currentPassword":"a-guess-123","newPassword":"attacker-password"}`
	right := fmt.Sprintf(`{"currentPassword":%q,"newPassword":"a-new-password"}`, testPassword)
	isRateLimited := func(rec *httptest.ResponseRecorder) bool {
		return rec.Code == http.StatusTooManyRequests && strings.Contains(rec.Body.String(), `"rate_limited"`) && rec.Header().Get("Retry-After") != ""
	}

	// Requests that never check the current password (an invalid new one) do not count.
	for i := range accountFailureBurst + 5 {
		if rec := meRequest(h, "203.0.113.1:1", victim.Token, `{"currentPassword":"a-guess-123","newPassword":"short"}`); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"newPassword"`) {
			t.Fatalf("invalid change %d: %d %s", i, rec.Code, rec.Body)
		}
	}

	// Per session, whatever the address: accountFailureBurst wrong guesses, then 429 — even
	// for the right password, which must not be confirmed either way.
	stolen := victim.Token
	for i := range accountFailureBurst {
		if rec := meRequest(h, fmt.Sprintf("203.0.113.%d:1", i+1), stolen, guess); rec.Code != http.StatusBadRequest {
			t.Fatalf("guess %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	if rec := meRequest(h, "203.0.113.99:1", stolen, right); !isRateLimited(rec) {
		t.Fatalf("throttled session: %d %s (Retry-After %q)", rec.Code, rec.Body, rec.Header().Get("Retry-After"))
	}
	// Renames still work, but a session cannot renew itself (and its budget) with one.
	nextTokenSecond()
	rec := meRequest(h, "203.0.113.99:1", stolen, `{"name":"Victim Renamed"}`)
	if renamed := decodeAs[dto.AuthResponse](t, &testResponse{Status: rec.Code, Body: rec.Body.Bytes()}, http.StatusOK); renamed.Token != stolen {
		t.Fatal("a rename returned a new session")
	}
	if rec := meRequest(h, "203.0.113.99:1", stolen, right); !isRateLimited(rec) {
		t.Fatalf("after a rename: %d %s", rec.Code, rec.Body)
	}
	// Other users are unaffected.
	if rec := meRequest(h, "203.0.113.99:1", other.Token, right); rec.Code != http.StatusOK {
		t.Fatalf("other user: %d %s", rec.Code, rec.Body)
	}
	// Whoever holds a stolen session cannot lock the owner out of the password change that
	// revokes it: signing in again (the guesses did not lock the account's sign-in) starts a
	// session with its own budget.
	nextTokenSecond()
	rec = authRequest(h, "/api/auth/login", "203.0.113.99:1", "", fmt.Sprintf(`{"email":%q,"password":%q}`, victim.Email, testPassword))
	owner := decodeAs[dto.AuthResponse](t, &testResponse{Status: rec.Code, Body: rec.Body.Bytes()}, http.StatusOK).Token
	if rec := meRequest(h, "198.51.100.1:1", owner, right); rec.Code != http.StatusOK {
		t.Fatalf("owner's new session: %d %s", rec.Code, rec.Body)
	}
	if rec := meRequest(h, "203.0.113.99:1", stolen, `{}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("stolen session after the change: %d %s", rec.Code, rec.Body)
	}

	// Per client address: password changes spend the sign-in budget; renames do not.
	e = newTestEnv(t)
	u := e.createUser("Client")
	h = NewRouter(Deps{Service: e.svc, Logger: discardLogger, AuthRateLimit: 3})
	const client = "198.51.100.7:4000"
	if rec := authRequest(h, "/api/auth/login", client, "", fmt.Sprintf(`{"email":%q,"password":%q}`, u.Email, testPassword)); rec.Code != http.StatusOK {
		t.Fatalf("login: %d", rec.Code)
	}
	for i := range 2 {
		if rec := meRequest(h, client, u.Token, guess); rec.Code != http.StatusBadRequest {
			t.Fatalf("guess %d: %d %s", i, rec.Code, rec.Body)
		}
	}
	if rec := meRequest(h, client, u.Token, guess); !isRateLimited(rec) {
		t.Fatalf("over the address budget: %d %s", rec.Code, rec.Body)
	}
	for i := range 5 {
		if rec := meRequest(h, client, u.Token, fmt.Sprintf(`{"name":"Client %d"}`, i)); rec.Code != http.StatusOK {
			t.Fatalf("rename %d: %d %s", i, rec.Code, rec.Body)
		}
	}
}

// TestConcurrentGuessesAreCounted: a failure budget is spent before the password is
// checked, so a burst of concurrent guesses (from many addresses, each within its own
// address budget) gets exactly the budget's guesses through, not one per request.
func TestConcurrentGuessesAreCounted(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Target")
	h := NewRouter(Deps{Service: e.svc, Logger: discardLogger, AuthRateLimit: 1000})
	const burst = 3 * accountFailureBurst

	// concurrently sends burst requests, each from its own address, and counts the statuses.
	concurrently := func(send func(peer string) *httptest.ResponseRecorder) map[int]int {
		var wg sync.WaitGroup
		codes := make(chan int, burst)
		for i := range burst {
			wg.Add(1)
			go func() {
				defer wg.Done()
				codes <- send(fmt.Sprintf("203.0.113.%d:1", i+1)).Code
			}()
		}
		wg.Wait()
		close(codes)
		counts := map[int]int{}
		for c := range codes {
			counts[c]++
		}
		return counts
	}
	want := map[int]int{http.StatusTooManyRequests: burst - accountFailureBurst}

	want[http.StatusBadRequest] = accountFailureBurst
	guess := `{"currentPassword":"a-guess-123","newPassword":"attacker-password"}`
	if got := concurrently(func(peer string) *httptest.ResponseRecorder { return meRequest(h, peer, u.Token, guess) }); !maps.Equal(got, want) {
		t.Errorf("wrong current passwords: statuses %v, want %v", got, want)
	}

	delete(want, http.StatusBadRequest)
	want[http.StatusUnauthorized] = accountFailureBurst
	wrong := fmt.Sprintf(`{"email":%q,"password":"wrong-password"}`, u.Email)
	if got := concurrently(func(peer string) *httptest.ResponseRecorder {
		return authRequest(h, "/api/auth/login", peer, "", wrong)
	}); !maps.Equal(got, want) {
		t.Errorf("failed logins: statuses %v, want %v", got, want)
	}
}

// TestRequestDeadlines (SEC-7): a client that sends its headers and then trickles (or
// withholds) the body is cut off after the read deadline instead of holding the
// connection forever. The websocket route is exempt: it keeps working past the deadlines.
func TestRequestDeadlines(t *testing.T) {
	e := newTestEnv(t)
	u := e.createUser("Owner")
	p := e.createProject(u, "GB")
	e.handler = NewRouter(Deps{
		Service: e.svc, Logger: discardLogger, CORSOrigins: []string{testCORSOrigin},
		RequestReadTimeout: 200 * time.Millisecond, ResponseWriteTimeout: 600 * time.Millisecond,
		WebsocketPingInterval: time.Hour,
	})
	base := e.URL()

	conn, err := net.Dial("tcp", strings.TrimPrefix(base, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	start := time.Now()
	fmt.Fprintf(conn, "POST /api/auth/login HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{")
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	res, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("stalled body: no response within 5s: %v", err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusBadRequest || time.Since(start) > 3*time.Second {
		t.Fatalf("stalled body: %d after %s", res.StatusCode, time.Since(start))
	}

	// The websocket outlives both deadlines and still receives events.
	ctx := t.Context()
	ws, _, err := websocket.Dial(ctx, strings.Replace(base, "http", "ws", 1)+"/api/projects/GB/ws?token="+u.Token, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	waitFor(t, func() bool { return e.hub.SubscriberCount(p.ID) == 1 }, "websocket subscription")
	time.Sleep(800 * time.Millisecond)
	e.newIssue(u, "GB", "task", "After the deadlines", nil)
	readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, msg, err := ws.Read(readCtx); err != nil || !strings.Contains(string(msg), "issue.created") {
		t.Fatalf("websocket after deadlines: %q, %v", msg, err)
	}
}
