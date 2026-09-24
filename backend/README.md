# Gene Board — backend

Go API for Gene Board, a Jira-style tracker. The HTTP contract is `../docs/SPEC.md`; the
database schema is `internal/database/migrations/00001_init.sql` (authoritative — never edit
it; add a new numbered migration instead).

## Layout

```
cmd/server/            `serve` (default: migrate + serve), `migrate`, `seed`, `healthcheck`
queries/*.sql          sqlc query files (one per resource)
sqlc.yaml              sqlc config -> internal/db
internal/
  config/              env configuration (DATABASE_URL, TEST_DATABASE_URL, PORT, JWT_SECRET, JWT_TTL, CORS_ORIGINS, AUTH_RATE_LIMIT, GB_CONTAINER)
  database/            pgxpool + goose migrations embedded with //go:embed
  db/                  sqlc-generated code — DO NOT EDIT (run `sqlc generate`)
  auth/                bcrypt PasswordHasher, HS256 JWT Tokens
  rank/                fractional-index rank keys: rank.Between(prev, next)
  realtime/            Hub: per-project pub/sub for websocket events
  httpx/               JSON helpers, error envelope (*httpx.Error), Optional[T], middleware
  dto/                 JSON resource shapes of SPEC §4 (+ Date, Timestamp)
  service/             domain logic: permissions, validation, transactions, activity log,
                       sprints lifecycle, board / backlog / epics read models
  api/                 chi router + thin handlers + the project websocket;
                       *_test.go = DB-backed integration tests
  seed/                demo data (SPEC §6), created through the service layer
Dockerfile             multi-stage build -> distroless, non-root runtime image
```

## Running

PostgreSQL runs in Docker (`docker compose up -d db` from the repo root; host port 5442,
databases `geneboard` and `geneboard_test`).

```sh
go run ./cmd/server              # migrate the dev DB, then serve on :8484
go run ./cmd/server migrate      # only apply migrations
go run ./cmd/server seed         # demo data (SPEC §6); does nothing if demo@geneboard.dev exists
go run ./cmd/server healthcheck  # exit 0 if the server on $PORT answers /api/health
```

The root `Makefile` wraps these (`make help`): `db-up`, `db-reset` (drop + recreate +
migrate), `migrate`, `seed`, `backend`, `dev` (API + Vite), `test-backend`, `sqlc`, ...

### Demo data
`seed` creates `demo@geneboard.dev`, `alex@geneboard.dev` and `sam@geneboard.dev` (password
`password123`), the Scrum project **GB** (3 epics, a completed, an active and a planned
sprint, a backlog, subtasks, labels, comments, links) and the Kanban project **OPS**. It
plays a four-week timeline through the service layer and backdates every step, so the
activity history, sprint dates and the Kanban 14-day window look real.

### Container
```sh
docker compose --profile full up -d --build   # db + api (port 8484; stop a local API first)
```
The `api` service (profile `full`) uses `backend/Dockerfile`: a static binary on
`distroless/static:nonroot`, health-checked with `server healthcheck`. The image sets
`GB_CONTAINER=1`: it never serves with the published development `JWT_SECRET` — without one it
generates a random secret per start (sign-ins end on restart); a secret you set must be at least
32 characters (`openssl rand -hex 32`). Compose publishes the API and the database on
127.0.0.1 only.

| Env var | Default |
|---|---|
| `DATABASE_URL` | `postgres://geneboard:geneboard@localhost:5442/geneboard?sslmode=disable` |
| `TEST_DATABASE_URL` | `postgres://geneboard:geneboard@localhost:5442/geneboard_test?sslmode=disable` |
| `PORT` | `8484` |
| `JWT_SECRET` | `dev-insecure-secret-change-me` (a warning is logged; container mode: random per start, or ≥ 32 characters) |
| `JWT_TTL` | `168h` |
| `CORS_ORIGINS` | `http://localhost:5173` (comma-separated; `*` allows any) |
| `AUTH_RATE_LIMIT` | `20` sign-in / register requests per client address per minute (`0` = off) |
| `GB_CONTAINER` | unset; `1` in the image (see `JWT_SECRET`) |

The server shuts down gracefully on SIGINT/SIGTERM (in-flight requests finish, websocket
subscriptions are closed through `Hub.Close`).

## Checks

```sh
sqlc generate          # regenerate internal/db after editing queries/ or migrations
gofmt -l .             # must print nothing
go vet ./...
go build ./...
go test -p 1 ./...     # -p 1: the api integration tests share the geneboard_test database
```

`internal/api` and `internal/seed` tests need PostgreSQL at `TEST_DATABASE_URL`; their
`TestMain` applies the migrations and every test starts from truncated tables. Tests there
must not call `t.Parallel()`.

## Conventions

### Errors
Services return `*httpx.Error` for anything the client should see:
`httpx.BadRequest`, `httpx.Validation(field, problem)`, `httpx.FieldErrors` (collect several
field problems, then `.Err()`), `httpx.Unauthorized`, `httpx.Forbidden`, `httpx.NotFound`,
`httpx.Conflict`. Any other error becomes a logged 500 `internal`. Messages are sentences
("Summary is required"); `fields` maps JSON field names to problems ("is required").
A request whose client has already gone away (navigation, an aborted fetch) and failed with
`context.Canceled` is not an internal error: it is recorded as status 499 in the access log.

### Permissions
Resolve every project-scoped resource through the service helpers, which return 404 for
non-members and 403 for insufficient roles:

```go
acc, err := s.projectByKey(ctx, q, userID, key, RoleMember) // or projectByID
acc, err := s.issueByKey(ctx, q, userID, issueKey, RoleViewer) // or issueByID
```

### Transactions, activity and realtime
```go
err := s.inTx(ctx, func(t *txn) error {
    // t.q is the transaction-bound *db.Queries
    if err := t.logActivity(ctx, userID, issueEntry(issue, ActionIssueUpdated).withValues("status", old, new)); err != nil {
        return err
    }
    t.publish(projectID, realtime.IssueUpdated, projectKey, issueKey, userID) // sent after COMMIT
    return nil
})
```
Activity rows are written in the same transaction as the change; realtime events are
queued and published only after a successful commit (never on rollback).

### Locking
Take the project row lock first when you need it (`LockProject`; `NextIssueNumber` also
locks it), then issue rows, then sprint rows. Row locks are `FOR NO KEY UPDATE`, never
`FOR UPDATE`: the latter also blocks the foreign-key checks of concurrent inserts
(activity rows, comments) and deadlocks writers that hold an issue lock. Sprint lifecycle
changes lock the sprint and then its issues (`lockSprint`, `ListSprintStandardIssues`);
putting an issue into a sprint share-locks the sprint (`resolveSprint`), so a sprint
cannot be completed or deleted while issues are added to it. `resolveParent`
share-locks the parent, so a new or re-parented subtask always copies the parent's
current sprint. `internal/api/concurrency_test.go` and the sprint race test guard this.
Multi-query reads (board, backlog, epics) run in `s.inReadTx`, a read-only REPEATABLE READ
snapshot. Timestamps computed in Go (`resolved_at`) use `t.now(ctx)`, the transaction's
database time, like the `created_at` / `updated_at` columns.

### Sprints, board, realtime
* `service/sprints.go`: lifecycle rules (SPEC §2); `sprintViews` renders Sprint DTOs with
  their statistics in one query; `txn.moveIssuesToSprint` moves standard issues (logging a
  sprint change each) and makes their subtasks follow.
* `service/board.go`: `Board`, `Backlog`, `Epics` (reuse `hydrateIssues`).
* `api/ws.go`: `GET /api/projects/{key}/ws?token=`; checks Origin (CORS_ORIGINS, same
  origin, loopback-to-loopback, or none), token and viewer access before upgrading, then
  forwards hub events as JSON text messages, pings every 30 s and re-checks token and
  membership at each ping and right after every `project.changed` event (member removed,
  project deleted), closing with 1008 when access is gone.

### Issues
* `hydrateIssues(ctx, q, []db.Issue) ([]dto.Issue, error)` is the only way to build Issue
  DTOs (constant number of queries). `hydrateIssue` and `issueDetail` wrap it.
* Hierarchy/sprint rules live in `service/issue_rules.go` (`resolveParent`,
  `resolveSprint`, `resolveLabels`, `resolvedAtFor`, `moveRank`, `txn.syncSubtaskSprints`).
* The dynamic search (`GET /issues`) is the only hand-written SQL
  (`service/issue_query.go`): values are always bind parameters; sort columns come from a
  whitelist.

### PATCH bodies
Use `httpx.Optional[T]` with the `omitzero` tag option:

```go
type UpdateThingInput struct {
    Name   httpx.Optional[string] `json:"name,omitzero"`   // absent / null / value
    LeadID httpx.Optional[int64]  `json:"leadId,omitzero"`
}
```
`Set` = present in the body, `Null` = explicit null. Reject null for non-nullable fields
with a validation error; skip writes (and activity, and `updated_at` bumps) when nothing
changes.

### Adding an endpoint
1. Add SQL to `queries/<resource>.sql` (`-- name: Foo :one|:many|:exec`), run `sqlc generate`.
2. Add a service method: permission helper → validation (trim strings) → `s.inTx` for
   writes (activity + `t.publish`) → return `dto` values.
3. Add a thin handler in `internal/api` (decode with `httpx.DecodeJSON`, call the service,
   `httpx.WriteJSON` with 201 for creates / `httpx.NoContent` for deletes) and mount it in
   `router.go` via `handle(...)`.
4. Add integration tests using the helpers in `internal/api/helpers_test.go`
   (`newTestEnv`, `createUser`, `createProject`, `addMember`, `newIssue`, `do`,
   `decodeAs[T]`, `expectError`, `expectFieldError`, `createSprint`, `startSprint`,
   `completeSprint`, `board`, `backlog`, `epics`, `dialProject` (websocket), ...).

### JSON
DTOs live in `internal/dto`: camelCase, nullable values are pointers without `omitempty`
(rendered as `null`), slices are never nil (rendered as `[]`), instants are `dto.Timestamp`
(RFC 3339 UTC, millisecond precision), calendar dates are `dto.Date` (`YYYY-MM-DD`).
