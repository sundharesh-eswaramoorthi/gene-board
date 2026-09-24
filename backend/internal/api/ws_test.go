package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"geneboard/internal/realtime"
)

// wsURL is the websocket URL of a project for token (served by e's test server).
func (e *testEnv) wsURL(projectKey, token string) string {
	return "ws" + strings.TrimPrefix(e.URL(), "http") + "/api/projects/" + projectKey + "/ws?token=" + token
}

// dialProject connects to a project's websocket and waits until the subscription is live.
func (e *testEnv) dialProject(projectKey string, projectID int64, u testUser, header http.Header) *websocket.Conn {
	e.t.Helper()
	before := e.hub.SubscriberCount(projectID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, res, err := websocket.Dial(ctx, e.wsURL(projectKey, u.Token), &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		e.t.Fatalf("dial %s: %v (response %+v)", projectKey, err, res)
	}
	e.t.Cleanup(func() { _ = conn.CloseNow() })
	waitFor(e.t, func() bool { return e.hub.SubscriberCount(projectID) > before }, "websocket subscription")
	return conn
}

// dialStatus attempts a websocket handshake and returns the HTTP status and decoded error
// envelope of the rejection.
func (e *testEnv) dialStatus(url string, header http.Header) (int, apiError) {
	e.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: header})
	if err == nil {
		_ = conn.CloseNow()
		return http.StatusSwitchingProtocols, apiError{}
	}
	if res == nil {
		e.t.Fatalf("dial %s: %v", url, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	var env struct {
		Error apiError `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		e.t.Fatalf("rejection is not a JSON envelope (%d): %q", res.StatusCode, body)
	}
	return res.StatusCode, env.Error
}

// readEvent reads the next realtime event (raw JSON and decoded).
func readEvent(t *testing.T, conn *websocket.Conn) (realtime.Event, map[string]json.RawMessage) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	typ, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read event: %v", err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("message type %v, want text", typ)
	}
	var ev realtime.Event
	if err := json.Unmarshal(data, &ev); err != nil {
		t.Fatalf("decode event %s: %v", data, err)
	}
	return ev, mustRaw(t, data)
}

// expectClosed reads until the server closes the connection and returns the close status.
func expectClosed(t *testing.T, conn *websocket.Conn) websocket.StatusCode {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		if _, data, err := conn.Read(ctx); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("connection was not closed")
			}
			return websocket.CloseStatus(err)
		} else {
			t.Logf("message before close: %s", data)
		}
	}
}

func waitFor(t *testing.T, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestWebsocketDeliversProjectEvents(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	viewer := e.createUser("Viewer")
	gb := e.createProject(owner, "GB")
	e.createProject(owner, "OPS")
	e.addMember(owner, "GB", viewer, "viewer")

	// A viewer may follow the project; project keys are case-insensitive. The Vite origin
	// is allowed.
	conn := e.dialProject("gb", gb.ID, viewer, http.Header{"Origin": {testCORSOrigin}})

	// Events of other projects are not delivered.
	e.newIssue(owner, "OPS", "task", "Elsewhere", nil)
	issue := e.newIssue(owner, "GB", "task", "Live", nil)
	ev, raw := readEvent(t, conn)
	if ev.Type != realtime.IssueCreated || ev.ProjectKey != "GB" || ev.IssueKey == nil || *ev.IssueKey != issue.Key || ev.ActorID != owner.ID {
		t.Fatalf("event: %+v", ev)
	}
	if len(raw) != 4 || raw["type"] == nil || raw["projectKey"] == nil || raw["issueKey"] == nil || raw["actorId"] == nil {
		t.Fatalf("event JSON shape: %v", raw)
	}

	sp := e.createSprint(owner, "GB", nil)
	if ev, raw := readEvent(t, conn); ev.Type != realtime.SprintChanged || string(raw["issueKey"]) != "null" {
		t.Fatalf("sprint event: %+v %s", ev, raw["issueKey"])
	}
	e.moveIssue(owner, issue.Key, map[string]any{"sprintId": sp.ID})
	if ev, _ := readEvent(t, conn); ev.Type != realtime.IssueMoved || *ev.IssueKey != issue.Key {
		t.Fatalf("move event: %+v", ev)
	}

	// Closing the connection unsubscribes it.
	if err := conn.Close(websocket.StatusNormalClosure, "bye"); err != nil {
		t.Fatalf("close: %v", err)
	}
	waitFor(t, func() bool { return e.hub.SubscriberCount(gb.ID) == 0 }, "unsubscribe after close")
}

func TestWebsocketHandshakeChecks(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	outsider := e.createUser("Outsider")
	gb := e.createProject(owner, "GB")
	base := "ws" + strings.TrimPrefix(e.URL(), "http") + "/api/projects/GB/ws"

	for _, c := range []struct {
		name   string
		url    string
		header http.Header
		status int
		code   string
	}{
		{"no token", base, nil, http.StatusUnauthorized, "unauthorized"},
		{"bad token", base + "?token=not-a-jwt", nil, http.StatusUnauthorized, "unauthorized"},
		{"non-member", e.wsURL("GB", outsider.Token), nil, http.StatusNotFound, "not_found"},
		{"unknown project", e.wsURL("NOPE", owner.Token), nil, http.StatusNotFound, "not_found"},
		{"foreign origin", e.wsURL("GB", owner.Token), http.Header{"Origin": {"http://evil.test"}}, http.StatusForbidden, "forbidden"},
	} {
		status, apiErr := e.dialStatus(c.url, c.header)
		if status != c.status || apiErr.Code != c.code {
			t.Errorf("%s: got %d %+v, want %d %s", c.name, status, apiErr, c.status, c.code)
		}
	}
	if n := e.hub.SubscriberCount(gb.ID); n != 0 {
		t.Fatalf("rejected handshakes left %d subscribers", n)
	}

	// Non-browser clients (no Origin), same-origin pages and local pages talking to a local
	// API (e.g. vite preview on :4173) are accepted; other hosts are not.
	for origin, want := range map[string]int{
		"":                        http.StatusSwitchingProtocols,
		e.URL():                   http.StatusSwitchingProtocols,
		"http://127.0.0.1:4173":   http.StatusSwitchingProtocols,
		"http://localhost:4173":   http.StatusSwitchingProtocols,
		"http://[::1]:5173":       http.StatusSwitchingProtocols,
		"http://192.168.1.5:5173": http.StatusForbidden,
		"null":                    http.StatusForbidden,
	} {
		header := http.Header{}
		if origin != "" {
			header.Set("Origin", origin)
		}
		if status, _ := e.dialStatus(e.wsURL("GB", owner.Token), header); status != want {
			t.Errorf("origin %q: status %d, want %d", origin, status, want)
		}
	}

	// A plain GET (no upgrade) with valid credentials gets a JSON 400.
	res := e.do(http.MethodGet, "/api/projects/GB/ws?token="+owner.Token, "", nil)
	expectError(t, res, http.StatusBadRequest, "bad_request")
}

func TestWebsocketPingAndAccessRevocation(t *testing.T) {
	e := newTestEnv(t)
	e.useWebsocketPingInterval(40 * time.Millisecond)
	owner := e.createUser("Owner")
	member := e.createUser("Member")
	gb := e.createProject(owner, "GB")
	e.addMember(owner, "GB", member, "member")

	ownerConn := e.dialProject("GB", gb.ID, owner, nil)
	memberConn := e.dialProject("GB", gb.ID, member, nil)

	// Several ping rounds later both connections are still healthy.
	time.Sleep(200 * time.Millisecond)
	issue := e.newIssue(owner, "GB", "task", "Still connected", nil)
	for _, c := range []*websocket.Conn{ownerConn, memberConn} {
		if ev, _ := readEvent(t, c); ev.Type != realtime.IssueCreated || *ev.IssueKey != issue.Key {
			t.Fatalf("event after pings: %+v", ev)
		}
	}

	// Removing the member closes their connection at the next check.
	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB/members/"+itoa(member.ID), owner.Token, nil), http.StatusNoContent)
	if ev, _ := readEvent(t, ownerConn); ev.Type != realtime.ProjectChanged {
		t.Fatalf("owner event: %+v", ev)
	}
	if status := expectClosed(t, memberConn); status != websocket.StatusPolicyViolation {
		t.Fatalf("revoked member close status = %v, want policy violation", status)
	}
	waitFor(t, func() bool { return e.hub.SubscriberCount(gb.ID) == 1 }, "revoked subscriber removal")

	// Server shutdown (hub closed) ends the remaining connection with "going away".
	e.hub.Close()
	if status := expectClosed(t, ownerConn); status != websocket.StatusGoingAway {
		t.Fatalf("shutdown close status = %v, want going away", status)
	}
}

// Losing access is noticed on the project.changed event itself, not only at the next ping
// (the default 30s interval is far beyond the 5s read deadline used here).
func TestWebsocketRevokesAccessOnProjectChange(t *testing.T) {
	e := newTestEnv(t)
	owner := e.createUser("Owner")
	member := e.createUser("Member")
	other := e.createUser("Other")
	gb := e.createProject(owner, "GB")
	e.addMember(owner, "GB", member, "member")
	e.addMember(owner, "GB", other, "viewer")

	ownerConn := e.dialProject("GB", gb.ID, owner, nil)
	memberConn := e.dialProject("GB", gb.ID, member, nil)
	otherConn := e.dialProject("GB", gb.ID, other, nil)

	// The removed member still gets the event (their client refetches and sees the project
	// is gone), then the connection closes with a policy violation.
	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB/members/"+itoa(member.ID), owner.Token, nil), http.StatusNoContent)
	for _, c := range []*websocket.Conn{ownerConn, memberConn, otherConn} {
		if ev, _ := readEvent(t, c); ev.Type != realtime.ProjectChanged {
			t.Fatalf("event after member removal: %+v", ev)
		}
	}
	if status := expectClosed(t, memberConn); status != websocket.StatusPolicyViolation {
		t.Fatalf("removed member close status = %v, want policy violation", status)
	}
	waitFor(t, func() bool { return e.hub.SubscriberCount(gb.ID) == 2 }, "removed member unsubscribed")

	// Members who keep access stay connected and keep receiving events.
	issue := e.newIssue(owner, "GB", "task", "Still here", nil)
	for _, c := range []*websocket.Conn{ownerConn, otherConn} {
		if ev, _ := readEvent(t, c); ev.Type != realtime.IssueCreated || *ev.IssueKey != issue.Key {
			t.Fatalf("event for remaining member: %+v", ev)
		}
	}

	// Deleting the project ends every connection to it.
	expectStatus(t, e.do(http.MethodDelete, "/api/projects/GB", owner.Token, nil), http.StatusNoContent)
	for _, c := range []*websocket.Conn{ownerConn, otherConn} {
		if ev, _ := readEvent(t, c); ev.Type != realtime.ProjectChanged {
			t.Fatalf("event after project deletion: %+v", ev)
		}
		if status := expectClosed(t, c); status != websocket.StatusPolicyViolation {
			t.Fatalf("close status after project deletion = %v, want policy violation", status)
		}
	}
	waitFor(t, func() bool { return e.hub.SubscriberCount(gb.ID) == 0 }, "all subscribers removed")
}
