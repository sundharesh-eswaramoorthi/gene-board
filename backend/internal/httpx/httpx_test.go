package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type patchBody struct {
	Name     Optional[string]  `json:"name,omitzero"`
	LeadID   Optional[int64]   `json:"leadId,omitzero"`
	LabelIDs Optional[[]int64] `json:"labelIds,omitzero"`
	Points   Optional[float64] `json:"points,omitzero"`
}

func TestOptionalUnmarshal(t *testing.T) {
	var b patchBody
	if err := json.Unmarshal([]byte(`{"name":"x","leadId":null,"labelIds":[1,2]}`), &b); err != nil {
		t.Fatal(err)
	}
	if !b.Name.Set || b.Name.Null || b.Name.Value != "x" || !b.Name.HasValue() {
		t.Errorf("name: %+v", b.Name)
	}
	if !b.LeadID.Set || !b.LeadID.Null || b.LeadID.HasValue() || b.LeadID.Ptr() != nil {
		t.Errorf("leadId: %+v", b.LeadID)
	}
	if !b.LabelIDs.HasValue() || len(b.LabelIDs.Value) != 2 {
		t.Errorf("labelIds: %+v", b.LabelIDs)
	}
	if b.Points.Set || b.Points.Null || b.Points.Ptr() != nil {
		t.Errorf("absent points: %+v", b.Points)
	}
}

func TestOptionalUnmarshalTypeError(t *testing.T) {
	var b patchBody
	if err := json.Unmarshal([]byte(`{"leadId":"abc"}`), &b); err == nil {
		t.Fatal("expected type error")
	}
}

func TestOptionalReuseResets(t *testing.T) {
	o := Some(int64(5))
	if err := o.UnmarshalJSON([]byte("null")); err != nil {
		t.Fatal(err)
	}
	if !o.Null || o.Value != 0 {
		t.Fatalf("null should reset the value: %+v", o)
	}
}

func TestOptionalMarshal(t *testing.T) {
	b := patchBody{Name: Some("n"), LeadID: Null[int64]()}
	out, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"name":"n","leadId":null}` {
		t.Fatalf("got %s", out)
	}
	p := Some(3.5).Ptr()
	if p == nil || *p != 3.5 {
		t.Fatal("Ptr")
	}
}

func decodeReq(t *testing.T, body string, dst any) error {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	if body == "" {
		r.Body = http.NoBody
	}
	return DecodeJSON(httptest.NewRecorder(), r, dst)
}

func TestDecodeJSON(t *testing.T) {
	type in struct {
		Name string `json:"name"`
		N    int    `json:"n"`
	}
	var ok in
	if err := decodeReq(t, `{"name":"a","n":2,"unknown":true}`, &ok); err != nil || ok.Name != "a" || ok.N != 2 {
		t.Fatalf("decode: %v %+v", err, ok)
	}
	bad := map[string]string{
		"empty":     "",
		"malformed": `{"name":`,
		"syntax":    `{name: 1}`,
		"type":      `{"n":"x"}`,
		"trailing":  `{"n":1} {"n":2}`,
		"tooLarge":  `{"name":"` + strings.Repeat("a", MaxBodyBytes) + `"}`,
	}
	for name, body := range bad {
		var dst in
		err := decodeReq(t, body, &dst)
		var e *Error
		if !errors.As(err, &e) || e.Status != http.StatusBadRequest || e.Code != CodeBadRequest {
			t.Errorf("%s: want bad_request, got %v", name, err)
		}
	}
}

func TestDecodeOptionalJSON(t *testing.T) {
	var dst struct{ A int }
	r := httptest.NewRequest(http.MethodPost, "/", http.NoBody)
	if err := DecodeOptionalJSON(httptest.NewRecorder(), r, &dst); err != nil {
		t.Fatal(err)
	}
	r = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	if err := DecodeOptionalJSON(httptest.NewRecorder(), r, &dst); err != nil {
		t.Fatal(err)
	}
}

func TestFieldErrors(t *testing.T) {
	var fe FieldErrors
	if fe.Err() != nil {
		t.Fatal("empty FieldErrors must return nil")
	}
	fe.Add("storyPoints", "must be between 0 and 1000")
	fe.Add("storyPoints", "ignored second problem")
	fe.Check(true, "summary", "is required")
	fe.Check(false, "summary", "is required")
	err := fe.Err()
	var e *Error
	if !errors.As(err, &e) || e.Code != CodeValidation || e.Status != 400 {
		t.Fatalf("got %v", err)
	}
	if e.Message != "Story points must be between 0 and 1000" {
		t.Errorf("message = %q", e.Message)
	}
	if e.Fields["storyPoints"] != "must be between 0 and 1000" || e.Fields["summary"] != "is required" || len(e.Fields) != 2 {
		t.Errorf("fields = %v", e.Fields)
	}
	if v := Validation("summary", "is required"); v.Message != "Summary is required" {
		t.Errorf("Validation message = %q", v.Message)
	}
}

func serve(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) errorBody {
	t.Helper()
	var env errorEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("bad envelope %q: %v", w.Body.String(), err)
	}
	return env.Error
}

func TestHandleRendersErrors(t *testing.T) {
	h := Handle(func(w http.ResponseWriter, r *http.Request) error {
		switch r.URL.Path {
		case "/typed":
			return Conflict("Key %s taken", "GB")
		case "/validation":
			return Validation("email", "is invalid")
		default:
			return errors.New("db exploded: secret details")
		}
	})
	w := serve(h, httptest.NewRequest(http.MethodGet, "/typed", nil))
	if w.Code != 409 || decodeEnvelope(t, w).Code != CodeConflict || decodeEnvelope(t, w).Message != "Key GB taken" {
		t.Errorf("typed: %d %s", w.Code, w.Body)
	}
	w = serve(h, httptest.NewRequest(http.MethodGet, "/validation", nil))
	if env := decodeEnvelope(t, w); w.Code != 400 || env.Fields["email"] != "is invalid" {
		t.Errorf("validation: %d %s", w.Code, w.Body)
	}
	w = serve(h, httptest.NewRequest(http.MethodGet, "/other", nil))
	env := decodeEnvelope(t, w)
	if w.Code != 500 || env.Code != CodeInternal || strings.Contains(w.Body.String(), "secret") {
		t.Errorf("internal: %d %s", w.Code, w.Body)
	}
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		t.Errorf("content type %q", w.Header().Get("Content-Type"))
	}
}

// A request whose client went away (the browser navigated or aborted the fetch) fails its
// queries with context.Canceled. That is not a server fault: it must not be logged as an
// internal error or counted as a 500.
func TestWriteErrorClientClosedRequest(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	h := RequestID(RequestLogger(logger)(Handle(func(http.ResponseWriter, *http.Request) error {
		return fmt.Errorf("list projects: %w", context.Canceled)
	})))

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // the client disconnected
	w := serve(h, httptest.NewRequest(http.MethodGet, "/api/projects", nil).WithContext(ctx))
	if w.Code != StatusClientClosedRequest {
		t.Errorf("status = %d, want %d", w.Code, StatusClientClosedRequest)
	}
	if strings.Contains(logs.String(), "level=ERROR") || strings.Contains(logs.String(), "internal error") {
		t.Errorf("client disconnect logged as an error:\n%s", logs.String())
	}
	if !strings.Contains(logs.String(), "status=499") {
		t.Errorf("access log should record status 499:\n%s", logs.String())
	}

	// The database driver interrupts an in-flight write of a cancelled request with a past
	// deadline: the error is then an I/O timeout, not context.Canceled.
	logs.Reset()
	interrupted := RequestID(RequestLogger(logger)(Handle(func(http.ResponseWriter, *http.Request) error {
		return fmt.Errorf("list members: write failed: %w", &net.OpError{Op: "write", Net: "tcp", Err: os.ErrDeadlineExceeded})
	})))
	w = serve(interrupted, httptest.NewRequest(http.MethodGet, "/api/projects/GB/members", nil).WithContext(ctx))
	if w.Code != StatusClientClosedRequest || strings.Contains(logs.String(), "level=ERROR") {
		t.Errorf("interrupted write of a cancelled request: %d\n%s", w.Code, logs.String())
	}

	// The same error while the client is still connected is a real internal error.
	logs.Reset()
	w = serve(h, httptest.NewRequest(http.MethodGet, "/api/projects", nil))
	if w.Code != http.StatusInternalServerError || decodeEnvelope(t, w).Code != CodeInternal {
		t.Errorf("live request: %d %s", w.Code, w.Body)
	}
	if !strings.Contains(logs.String(), "level=ERROR") {
		t.Errorf("internal error not logged:\n%s", logs.String())
	}
}

func TestRecovererAndLogger(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := RequestID(RequestLogger(logger)(Recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))))
	w := serve(h, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != 500 || decodeEnvelope(t, w).Code != CodeInternal {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	if w.Header().Get(RequestIDHeader) == "" {
		t.Fatal("missing request id header")
	}
}

func TestRecovererReraisesAbort(t *testing.T) {
	h := Recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) }))
	defer func() {
		if rec := recover(); rec != http.ErrAbortHandler {
			t.Fatalf("expected ErrAbortHandler to propagate, got %v", rec)
		}
	}()
	serve(h, httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestRequestIDReuse(t *testing.T) {
	var seen string
	h := RequestID(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { seen = RequestIDFrom(r.Context()) }))
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set(RequestIDHeader, "abc-123")
	w := serve(h, r)
	if seen != "abc-123" || w.Header().Get(RequestIDHeader) != "abc-123" {
		t.Fatalf("seen %q", seen)
	}
	r.Header.Set(RequestIDHeader, "bad id with spaces")
	serve(h, r)
	if seen == "bad id with spaces" || len(seen) != 16 {
		t.Fatalf("invalid incoming id should be replaced, got %q", seen)
	}
}

func TestCORS(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := CORS([]string{"http://localhost:5173"})(next)

	pre := httptest.NewRequest(http.MethodOptions, "/api/projects", nil)
	pre.Header.Set("Origin", "http://localhost:5173")
	pre.Header.Set("Access-Control-Request-Method", "PATCH")
	w := serve(h, pre)
	if w.Code != http.StatusNoContent ||
		w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" ||
		!strings.Contains(w.Header().Get("Access-Control-Allow-Methods"), "PATCH") ||
		!strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatalf("preflight: %d %v", w.Code, w.Header())
	}

	get := httptest.NewRequest(http.MethodGet, "/", nil)
	get.Header.Set("Origin", "http://localhost:5173")
	w = serve(h, get)
	if w.Code != http.StatusTeapot || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("simple: %d %v", w.Code, w.Header())
	}

	evil := httptest.NewRequest(http.MethodGet, "/", nil)
	evil.Header.Set("Origin", "http://evil.test")
	w = serve(h, evil)
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("disallowed origin must not get CORS headers")
	}
	if !OriginAllowed([]string{"http://a.test"}, "http://a.test/") || OriginAllowed([]string{"http://a.test"}, "http://b.test") {
		t.Fatal("OriginAllowed")
	}
}

func TestRequireAuth(t *testing.T) {
	verify := func(_ context.Context, tok string) (int64, error) {
		switch tok {
		case "good":
			return 7, nil
		case "broken":
			return 0, errors.New("database unreachable")
		}
		return 0, Unauthorized("revoked")
	}
	var got int64
	h := RequireAuth(verify)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = MustUserID(r.Context()) }))

	for _, header := range []string{"", "Bearer", "Basic good", "Bearer bad", "Bearer "} {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		if header != "" {
			r.Header.Set("Authorization", header)
		}
		w := serve(h, r)
		if w.Code != 401 || decodeEnvelope(t, w).Code != CodeUnauthorized {
			t.Errorf("%q: got %d", header, w.Code)
		}
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "bearer good")
	if w := serve(h, r); w.Code != 200 || got != 7 {
		t.Fatalf("valid token: %d user=%d", w.Code, got)
	}
	// A failing check is a server error, not a reason to sign the client out.
	r = httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer broken")
	if w := serve(h, r); w.Code != 500 || decodeEnvelope(t, w).Code != CodeInternal {
		t.Fatalf("failing check: got %d", w.Code)
	}
}

func TestHumanizeField(t *testing.T) {
	for in, want := range map[string]string{
		"summary": "Summary", "storyPoints": "Story points", "currentPassword": "Current password",
		"labelIds": "Labels", "statusIds": "Statuses", "parentId": "Parent", "prevIssueId": "Prev issue", "id": "Id",
	} {
		if got := HumanizeField(in); got != want {
			t.Errorf("HumanizeField(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestDatabaseErrorsCausedByTheRequest: the few database errors that stem from the input or
// from a race with another request are client errors, not 500s (backstops for the service's
// own validation and locking).
func TestDatabaseErrorsCausedByTheRequest(t *testing.T) {
	for code, want := range map[string]int{
		"22021": http.StatusBadRequest, // NUL in text
		"23503": http.StatusConflict,   // referenced row deleted concurrently
		"40P01": http.StatusConflict,   // deadlock
		"23505": http.StatusInternalServerError,
	} {
		err := fmt.Errorf("create comment: %w", &pgconn.PgError{Code: code})
		w := httptest.NewRecorder()
		WriteError(w, httptest.NewRequest(http.MethodPost, "/", nil), err)
		if w.Code != want {
			t.Errorf("SQLSTATE %s: status %d, want %d", code, w.Code, want)
		}
	}
}

func TestTooManyRequests(t *testing.T) {
	for wait, want := range map[time.Duration]string{
		0:                "Try again in a moment.",
		20 * time.Second: "Try again in 20 seconds.",
		10 * time.Minute: "Try again in 10 minutes.",
	} {
		e := TooManyRequests("Slow down.", wait)
		if e.Status != http.StatusTooManyRequests || e.Code != CodeRateLimited || e.Message != "Slow down. "+want {
			t.Errorf("%s: %+v", wait, e)
		}
	}
}

func TestRejectInvalidText(t *testing.T) {
	h := RejectInvalidText(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	for target, want := range map[string]int{
		"/api/issues?q=caf%C3%A9": http.StatusNoContent,
		"/api/issues?q=a%00b":     http.StatusBadRequest,
		"/api/issues?q=%FF":       http.StatusBadRequest,
		"/api/issues?%00=x":       http.StatusBadRequest,
		"/api/projects/G%00B":     http.StatusBadRequest,
	} {
		if w := serve(h, httptest.NewRequest(http.MethodGet, target, nil)); w.Code != want {
			t.Errorf("%s: %d, want %d", target, w.Code, want)
		}
	}
}
