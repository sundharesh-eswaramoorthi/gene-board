package seed

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"slices"
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
	"geneboard/internal/service"
)

// The seed test runs against the shared test database (TEST_DATABASE_URL), like the api
// integration tests; run packages with `go test -p 1 ./...`.

var testPool *pgxpool.Pool

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestMain(m *testing.M) {
	dsn := config.DefaultTestDatabaseURL
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		dsn = v
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "seed tests need PostgreSQL (TEST_DATABASE_URL=%s): %v\n", dsn, err)
		os.Exit(1)
	}
	if err := database.Migrate(ctx, pool, discard); err != nil {
		fmt.Fprintf(os.Stderr, "migrating test database: %v\n", err)
		os.Exit(1)
	}
	testPool = pool
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

func resetDatabase(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	rows, err := testPool.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'goose_db_version'`)
	if err != nil {
		t.Fatal(err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	for i, n := range names {
		names[i] = pgx.Identifier{n}.Sanitize()
	}
	if _, err := testPool.Exec(ctx, "TRUNCATE "+strings.Join(names, ", ")+" RESTART IDENTITY CASCADE"); err != nil {
		t.Fatal(err)
	}
}

func count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func keys(issues []dto.Issue) []string {
	out := make([]string, len(issues))
	for i, is := range issues {
		out[i] = is.Summary
	}
	return out
}

func TestSeedCreatesDemoDataOnce(t *testing.T) {
	resetDatabase(t)
	ctx := context.Background()
	svc := service.New(service.Options{
		Pool:   testPool,
		Tokens: auth.NewTokens("seed-test", time.Hour),
		Hasher: auth.NewPasswordHasher(bcrypt.MinCost),
		Logger: discard,
	})
	started := time.Now()
	if err := Run(ctx, svc, testPool, discard); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Every account works with the documented password.
	var demo int64
	for _, email := range []string{DemoEmail, "alex@geneboard.dev", "sam@geneboard.dev"} {
		res, err := svc.Login(ctx, service.LoginInput{Email: email, Password: DemoPassword})
		if err != nil {
			t.Fatalf("login %s: %v", email, err)
		}
		if email == DemoEmail {
			demo = res.User.ID
		}
	}

	projects, err := svc.ListProjects(ctx, demo)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 2 || projects[0].Key != "GB" || projects[0].Type != "scrum" || projects[0].MyRole != "admin" ||
		projects[1].Key != "OPS" || projects[1].Type != "kanban" || projects[0].Lead == nil {
		t.Fatalf("projects: %+v", projects)
	}
	for _, key := range []string{"GB", "OPS"} {
		if members, err := svc.ListMembers(ctx, demo, key); err != nil || len(members) != 3 {
			t.Fatalf("%s members: %+v %v", key, members, err)
		}
	}

	// GB: a completed, an active and a planned sprint.
	sprints, err := svc.ListSprints(ctx, demo, "GB", nil)
	if err != nil {
		t.Fatal(err)
	}
	var states []string
	for _, sp := range sprints {
		states = append(states, sp.Name+"="+sp.State)
	}
	if !slices.Equal(states, []string{"GB Sprint 2=active", "GB Sprint 3=planned", "GB Sprint 1=completed"}) {
		t.Fatalf("sprints: %v", states)
	}
	completed := sprints[2]
	if completed.IssueCount != 4 || completed.PointsDone != completed.PointsTotal || completed.CompletedAt == nil ||
		time.Since(completed.CompletedAt.Time) < 6*24*time.Hour || time.Since(completed.CompletedAt.Time) > 8*24*time.Hour {
		t.Fatalf("completed sprint: %+v", completed)
	}
	if active := sprints[0]; active.StartDate == nil || active.EndDate == nil || active.Goal == "" || active.IssueCount != 6 {
		t.Fatalf("active sprint: %+v", active)
	}

	board, err := svc.Board(ctx, demo, "GB")
	if err != nil {
		t.Fatal(err)
	}
	perCategory := map[string]int{}
	for _, is := range board.Issues {
		perCategory[is.Status.Category]++
	}
	if board.Sprint == nil || len(board.Issues) != 9 || perCategory["todo"] == 0 || perCategory["in_progress"] == 0 || perCategory["done"] == 0 {
		t.Fatalf("GB board: %d issues %v", len(board.Issues), perCategory)
	}

	backlog, err := svc.Backlog(ctx, demo, "GB")
	if err != nil {
		t.Fatal(err)
	}
	if len(backlog.Sprints) != 2 || len(backlog.Sprints[0].Issues) != 6 || len(backlog.Sprints[1].Issues) != 3 || len(backlog.Backlog) != 4 {
		t.Fatalf("GB backlog: sprints=%d backlog=%v", len(backlog.Sprints), keys(backlog.Backlog))
	}
	if first := backlog.Sprints[0].Issues[0]; first.Summary != "Live-update the board when teammates move cards" {
		t.Fatalf("sprint 2 should start with its main story, got %q", first.Summary)
	}

	epics, err := svc.Epics(ctx, demo, "GB")
	if err != nil {
		t.Fatal(err)
	}
	if len(epics) != 3 || epics[2].Epic.Summary != "Accounts & onboarding" || epics[2].Total != 4 || epics[2].Done != 2 || epics[2].InProgress != 1 {
		t.Fatalf("epics: %+v", epics)
	}

	// OPS: Kanban board without the issue resolved three weeks ago; In Progress at its WIP limit.
	opsBoard, err := svc.Board(ctx, demo, "OPS")
	if err != nil {
		t.Fatal(err)
	}
	inProgress := 0
	for _, is := range opsBoard.Issues {
		if is.Summary == "Nightly backup job timed out" {
			t.Fatal("the old resolved issue must be outside the Kanban window")
		}
		if is.Status.Name == "In Progress" {
			inProgress++
		}
	}
	if len(opsBoard.Issues) != 8 || opsBoard.Sprint != nil || inProgress != 3 || opsBoard.Statuses[1].WipLimit == nil || *opsBoard.Statuses[1].WipLimit != 3 {
		t.Fatalf("OPS board: %d issues, %d in progress, statuses %+v", len(opsBoard.Issues), inProgress, opsBoard.Statuses)
	}

	// Rich issues: descriptions, comments, links and history.
	search, err := service.ParseIssueSearch(url.Values{"project": {"GB"}, "limit": {"200"}})
	if err != nil {
		t.Fatal(err)
	}
	all, err := svc.SearchIssues(ctx, demo, search)
	if err != nil {
		t.Fatal(err)
	}
	if all.Total != 25 {
		t.Fatalf("GB issue count = %d", all.Total)
	}
	var live dto.Issue
	for _, is := range all.Items {
		if is.Summary == "Live-update the board when teammates move cards" {
			live = is
		}
	}
	detail, err := svc.GetIssue(ctx, demo, live.Key)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Children) != 3 || len(detail.Links) != 1 || detail.Links[0].Label != "is blocked by" ||
		!strings.Contains(detail.Description, "### Notes") || detail.DueDate == nil {
		t.Fatalf("live story detail: %+v", detail)
	}
	if n := count(t, `SELECT count(*) FROM comments`); n < 10 {
		t.Fatalf("only %d comments", n)
	}
	if n := count(t, `SELECT count(*) FROM comments WHERE body LIKE '%`+"`"+`%'`); n == 0 {
		t.Fatal("Markdown code spans were not converted to backticks")
	}

	// The history spans four weeks, entirely in the past, on many distinct days.
	if n := count(t, `SELECT count(*) FROM activities WHERE created_at > $1`, started); n != 0 {
		t.Fatalf("%d activity rows are not backdated", n)
	}
	for _, table := range []string{"issues", "comments", "sprints", "users", "projects"} {
		if n := count(t, `SELECT count(*) FROM `+table+` WHERE created_at > $1`, started); n != 0 {
			t.Fatalf("%d %s rows are not backdated", n, table)
		}
	}
	if n := count(t, `SELECT count(DISTINCT created_at::date) FROM activities`); n < 15 {
		t.Fatalf("history spans only %d days", n)
	}
	if n := count(t, `SELECT count(*) FROM activities WHERE created_at < now() - interval '27 days'`); n == 0 {
		t.Fatal("history does not reach back four weeks")
	}
	if n := count(t, `SELECT count(*) FROM issues WHERE resolved_at IS NOT NULL AND resolved_at < created_at`); n != 0 {
		t.Fatalf("%d issues resolved before they were created", n)
	}
	if n := count(t, `SELECT count(*) FROM activities WHERE action = 'issue.updated' AND field = 'status'`); n < 30 {
		t.Fatalf("only %d status changes in the history", n)
	}

	// Seeding again is a no-op.
	users := count(t, `SELECT count(*) FROM users`)
	if err := Run(ctx, svc, testPool, discard); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if n := count(t, `SELECT count(*) FROM users`); n != users || count(t, `SELECT count(*) FROM projects`) != 2 {
		t.Fatalf("second run changed the data (%d users)", n)
	}
}
