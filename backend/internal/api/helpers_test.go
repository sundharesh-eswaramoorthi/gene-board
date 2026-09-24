package api

// Integration-test harness: a real router + service on the geneboard_test database.
//
// Every test calls newTestEnv(t), which truncates all tables (RESTART IDENTITY) so tests
// are independent. Tests in this package must not use t.Parallel() (they share one
// database) and packages must run with `go test -p 1 ./...`.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"geneboard/internal/auth"
	"geneboard/internal/config"
	"geneboard/internal/database"
	"geneboard/internal/dto"
	"geneboard/internal/realtime"
	"geneboard/internal/service"
)

// testPool is the shared connection pool to the migrated test database.
var testPool *pgxpool.Pool

var discardLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestMain(m *testing.M) {
	url := config.DefaultTestDatabaseURL
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		url = v
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url)
	if err != nil {
		fmt.Fprintf(os.Stderr, "api integration tests need PostgreSQL (TEST_DATABASE_URL=%s): %v\n", url, err)
		os.Exit(1)
	}
	if err := database.Migrate(ctx, pool, discardLogger); err != nil {
		fmt.Fprintf(os.Stderr, "migrating test database: %v\n", err)
		os.Exit(1)
	}
	testPool = pool
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

// testEnv is a clean database plus a router wired exactly like production (except for a
// fast bcrypt cost and a fixed JWT secret).
type testEnv struct {
	t       *testing.T
	handler http.Handler
	svc     *service.Service
	hub     *realtime.Hub
	pool    *pgxpool.Pool
	server  *httptest.Server // started lazily by URL()
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	resetDatabase(t)
	hub := realtime.NewHub(realtime.DefaultBuffer)
	svc := service.New(service.Options{
		Pool:   testPool,
		Hub:    hub,
		Tokens: auth.NewTokens("test-secret", time.Hour),
		Hasher: auth.NewPasswordHasher(bcrypt.MinCost),
		Logger: discardLogger,
	})
	e := &testEnv{t: t, svc: svc, hub: hub, pool: testPool}
	e.handler = e.router(0)
	return e
}

// testCORSOrigin is the only CORS origin the test router allows.
const testCORSOrigin = "http://localhost:5173"

// router builds the production router over e's service (pingInterval 0 = default).
func (e *testEnv) router(pingInterval time.Duration) http.Handler {
	return NewRouter(Deps{Service: e.svc, Logger: discardLogger, CORSOrigins: []string{testCORSOrigin}, WebsocketPingInterval: pingInterval})
}

// useWebsocketPingInterval rebuilds the router with a short websocket ping interval. Call
// it before URL().
func (e *testEnv) useWebsocketPingInterval(d time.Duration) {
	if e.server != nil {
		e.t.Fatal("useWebsocketPingInterval must be called before URL()")
	}
	e.handler = e.router(d)
}

// URL starts (once) a real HTTP server for the router, e.g. for websocket tests.
func (e *testEnv) URL() string {
	if e.server == nil {
		e.server = httptest.NewServer(e.handler)
		e.t.Cleanup(e.server.Close)
	}
	return e.server.URL
}

// resetDatabase truncates every application table (not goose's version table).
func resetDatabase(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	rows, err := testPool.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'goose_db_version'`)
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	for i, n := range names {
		names[i] = pgx.Identifier{n}.Sanitize()
	}
	if _, err := testPool.Exec(ctx, "TRUNCATE "+strings.Join(names, ", ")+" RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
}

// --- raw requests ---

// testResponse is a recorded HTTP response.
type testResponse struct {
	Status int
	Header http.Header
	Body   []byte
}

// apiError is the decoded error envelope.
type apiError struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields"`
}

// do performs a request against the router. body may be nil, a string (sent verbatim) or
// any value (JSON-encoded). token may be empty.
func (e *testEnv) do(method, path, token string, body any) *testResponse {
	e.t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			e.t.Fatalf("encode body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return &testResponse{Status: rec.Code, Header: rec.Header(), Body: rec.Body.Bytes()}
}

// decodeAs asserts the status and decodes the JSON body into T.
func decodeAs[T any](t *testing.T, res *testResponse, wantStatus int) T {
	t.Helper()
	var out T
	if res.Status != wantStatus {
		t.Fatalf("status = %d, want %d; body: %s", res.Status, wantStatus, res.Body)
	}
	if err := json.Unmarshal(res.Body, &out); err != nil {
		t.Fatalf("decode %T: %v; body: %s", out, err, res.Body)
	}
	return out
}

// expectStatus asserts the status code (e.g. 204).
func expectStatus(t *testing.T, res *testResponse, want int) {
	t.Helper()
	if res.Status != want {
		t.Fatalf("status = %d, want %d; body: %s", res.Status, want, res.Body)
	}
}

// expectError asserts an error envelope with the given status and code.
func expectError(t *testing.T, res *testResponse, status int, code string) apiError {
	t.Helper()
	env := decodeAs[struct {
		Error apiError `json:"error"`
	}](t, res, status)
	if env.Error.Code != code {
		t.Fatalf("error code = %q, want %q; body: %s", env.Error.Code, code, res.Body)
	}
	if env.Error.Message == "" {
		t.Fatalf("error without message: %s", res.Body)
	}
	return env.Error
}

// expectFieldError asserts a 400 validation_error mentioning field.
func expectFieldError(t *testing.T, res *testResponse, field string) apiError {
	t.Helper()
	e := expectError(t, res, http.StatusBadRequest, "validation_error")
	if _, ok := e.Fields[field]; !ok {
		t.Fatalf("validation error does not mention %q: %+v", field, e)
	}
	return e
}

// --- fixtures ---

const testPassword = "password123"

// testUser is a registered user with a valid token.
type testUser struct {
	ID    int64
	Name  string
	Email string
	Token string
}

// createUser registers a user; the e-mail is derived from the name.
func (e *testEnv) createUser(name string) testUser {
	e.t.Helper()
	email := strings.ToLower(strings.ReplaceAll(name, " ", ".")) + "@example.test"
	res := decodeAs[dto.AuthResponse](e.t, e.do(http.MethodPost, "/api/auth/register", "", map[string]any{
		"email": email, "name": name, "password": testPassword,
	}), http.StatusCreated)
	return testUser{ID: res.User.ID, Name: name, Email: email, Token: res.Token}
}

// nextTokenSecond waits for the next wall-clock second. JWT times have a one-second
// resolution, so a token issued within the second another was (same user and version) is
// the very same string: a test asserting that a request did not mint a new token waits first,
// or a fresh token would be indistinguishable from the old one.
func nextTokenSecond() {
	time.Sleep(time.Until(time.Now().Truncate(time.Second).Add(time.Second)))
}

// createProject creates a Scrum project named "<key> Project" owned by u.
func (e *testEnv) createProject(u testUser, key string) dto.Project {
	e.t.Helper()
	return e.createProjectOfType(u, key, "scrum")
}

func (e *testEnv) createProjectOfType(u testUser, key, projectType string) dto.Project {
	e.t.Helper()
	return decodeAs[dto.Project](e.t, e.do(http.MethodPost, "/api/projects", u.Token, map[string]any{
		"key": key, "name": key + " Project", "type": projectType,
	}), http.StatusCreated)
}

// addMember adds member to the project with role (admin must be a project admin).
func (e *testEnv) addMember(admin testUser, projectKey string, member testUser, role string) dto.Member {
	e.t.Helper()
	return decodeAs[dto.Member](e.t, e.do(http.MethodPost, "/api/projects/"+projectKey+"/members", admin.Token, map[string]any{
		"email": member.Email, "role": role,
	}), http.StatusCreated)
}

// createIssue creates an issue from a raw body and returns the detail.
func (e *testEnv) createIssue(u testUser, projectKey string, body map[string]any) dto.IssueDetail {
	e.t.Helper()
	return decodeAs[dto.IssueDetail](e.t, e.do(http.MethodPost, "/api/projects/"+projectKey+"/issues", u.Token, body), http.StatusCreated)
}

// newIssue creates an issue of the given type and summary, merging extra fields.
func (e *testEnv) newIssue(u testUser, projectKey, issueType, summary string, extra map[string]any) dto.IssueDetail {
	e.t.Helper()
	body := map[string]any{"type": issueType, "summary": summary}
	for k, v := range extra {
		body[k] = v
	}
	return e.createIssue(u, projectKey, body)
}

func (e *testEnv) getIssue(u testUser, issueKey string) dto.IssueDetail {
	e.t.Helper()
	return decodeAs[dto.IssueDetail](e.t, e.do(http.MethodGet, "/api/issues/"+issueKey, u.Token, nil), http.StatusOK)
}

func (e *testEnv) patchIssue(u testUser, issueKey string, body any) dto.IssueDetail {
	e.t.Helper()
	return decodeAs[dto.IssueDetail](e.t, e.do(http.MethodPatch, "/api/issues/"+issueKey, u.Token, body), http.StatusOK)
}

func (e *testEnv) moveIssue(u testUser, issueKey string, body any) dto.Issue {
	e.t.Helper()
	return decodeAs[dto.Issue](e.t, e.do(http.MethodPost, "/api/issues/"+issueKey+"/move", u.Token, body), http.StatusOK)
}

func (e *testEnv) statuses(u testUser, projectKey string) []dto.Status {
	e.t.Helper()
	return decodeAs[[]dto.Status](e.t, e.do(http.MethodGet, "/api/projects/"+projectKey+"/statuses", u.Token, nil), http.StatusOK)
}

// statusNamed returns the project's status with the given name.
func (e *testEnv) statusNamed(u testUser, projectKey, name string) dto.Status {
	e.t.Helper()
	for _, s := range e.statuses(u, projectKey) {
		if s.Name == name {
			return s
		}
	}
	e.t.Fatalf("status %q not found in %s", name, projectKey)
	return dto.Status{}
}

func (e *testEnv) createLabel(u testUser, projectKey, name string) dto.Label {
	e.t.Helper()
	return decodeAs[dto.Label](e.t, e.do(http.MethodPost, "/api/projects/"+projectKey+"/labels", u.Token, map[string]any{"name": name}), http.StatusCreated)
}

func (e *testEnv) issueActivity(u testUser, issueKey string) []dto.Activity {
	e.t.Helper()
	return decodeAs[[]dto.Activity](e.t, e.do(http.MethodGet, "/api/issues/"+issueKey+"/activity", u.Token, nil), http.StatusOK)
}

// searchIssues runs GET /issues with a raw query string.
func (e *testEnv) searchIssues(u testUser, query string) dto.Page[dto.Issue] {
	e.t.Helper()
	return decodeAs[dto.Page[dto.Issue]](e.t, e.do(http.MethodGet, "/api/issues?"+query, u.Token, nil), http.StatusOK)
}

// insertSprint creates a sprint directly in the database, bypassing the sprint lifecycle
// (e.g. to get a completed sprint in one step). state: planned | active | completed.
func (e *testEnv) insertSprint(projectID int64, name, state string) int64 {
	e.t.Helper()
	var id int64
	err := e.pool.QueryRow(context.Background(),
		`INSERT INTO sprints (project_id, name, state) VALUES ($1, $2, $3) RETURNING id`, projectID, name, state).Scan(&id)
	if err != nil {
		e.t.Fatalf("insert sprint: %v", err)
	}
	return id
}

// --- sprints, board, backlog, epics ---

func sprintPath(id int64, suffix string) string { return "/api/sprints/" + itoa(id) + suffix }

// createSprint creates a sprint through the API (body may be nil).
func (e *testEnv) createSprint(u testUser, projectKey string, body map[string]any) dto.Sprint {
	e.t.Helper()
	if body == nil {
		body = map[string]any{}
	}
	return decodeAs[dto.Sprint](e.t, e.do(http.MethodPost, "/api/projects/"+projectKey+"/sprints", u.Token, body), http.StatusCreated)
}

// startSprint starts a sprint with the given YYYY-MM-DD dates.
func (e *testEnv) startSprint(u testUser, sprintID int64, start, end string) dto.Sprint {
	e.t.Helper()
	return decodeAs[dto.Sprint](e.t, e.do(http.MethodPost, sprintPath(sprintID, "/start"), u.Token,
		map[string]any{"startDate": start, "endDate": end}), http.StatusOK)
}

// completeSprint completes a sprint with the given body ({target, sprintId}).
func (e *testEnv) completeSprint(u testUser, sprintID int64, body map[string]any) dto.CompleteSprintResult {
	e.t.Helper()
	return decodeAs[dto.CompleteSprintResult](e.t, e.do(http.MethodPost, sprintPath(sprintID, "/complete"), u.Token, body), http.StatusOK)
}

func (e *testEnv) getSprint(u testUser, sprintID int64) dto.Sprint {
	e.t.Helper()
	return decodeAs[dto.Sprint](e.t, e.do(http.MethodGet, sprintPath(sprintID, ""), u.Token, nil), http.StatusOK)
}

// listSprints runs GET /projects/{key}/sprints with a raw query string.
func (e *testEnv) listSprints(u testUser, projectKey, query string) []dto.Sprint {
	e.t.Helper()
	return decodeAs[[]dto.Sprint](e.t, e.do(http.MethodGet, "/api/projects/"+projectKey+"/sprints?"+query, u.Token, nil), http.StatusOK)
}

func (e *testEnv) board(u testUser, projectKey string) dto.Board {
	e.t.Helper()
	return decodeAs[dto.Board](e.t, e.do(http.MethodGet, "/api/projects/"+projectKey+"/board", u.Token, nil), http.StatusOK)
}

func (e *testEnv) backlog(u testUser, projectKey string) dto.Backlog {
	e.t.Helper()
	return decodeAs[dto.Backlog](e.t, e.do(http.MethodGet, "/api/projects/"+projectKey+"/backlog", u.Token, nil), http.StatusOK)
}

func (e *testEnv) epics(u testUser, projectKey string) []dto.EpicProgress {
	e.t.Helper()
	return decodeAs[[]dto.EpicProgress](e.t, e.do(http.MethodGet, "/api/projects/"+projectKey+"/epics", u.Token, nil), http.StatusOK)
}

func (e *testEnv) projectActivity(u testUser, projectKey string) []dto.Activity {
	e.t.Helper()
	return decodeAs[[]dto.Activity](e.t, e.do(http.MethodGet, "/api/projects/"+projectKey+"/activity?limit=200", u.Token, nil), http.StatusOK)
}

// exec runs raw SQL against the test database (for states the API cannot produce).
func (e *testEnv) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatalf("exec %q: %v", sql, err)
	}
}

// sprintIDOf returns the id of an issue's sprint (0 for the backlog).
func sprintIDOf(is dto.Issue) int64 {
	if is.Sprint == nil {
		return 0
	}
	return is.Sprint.ID
}

// --- small assertion helpers ---

func keysOf(issues []dto.Issue) []string {
	out := make([]string, len(issues))
	for i, is := range issues {
		out[i] = is.Key
	}
	return out
}

func expectKeys(t *testing.T, got []dto.Issue, want ...string) {
	t.Helper()
	if keys := keysOf(got); !slices.Equal(keys, want) {
		t.Fatalf("issue keys = %v, want %v", keys, want)
	}
}

// activitiesFor filters activity rows by action and field ("" matches any field).
func activitiesFor(rows []dto.Activity, action, field string) []dto.Activity {
	var out []dto.Activity
	for _, a := range rows {
		if a.Action == action && (field == "" || (a.Field != nil && *a.Field == field)) {
			out = append(out, a)
		}
	}
	return out
}

func strp(s string) *string { return &s }

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}
