# Gene Board — Product & API Specification

Gene Board is a Jira-style project tracker: projects, epics → stories/tasks/bugs → subtasks,
Scrum (sprints + backlog) and Kanban boards with drag-and-drop, comments, labels, issue links,
search, and an activity/history log.

This document is the **contract** between the Go backend and the React frontend. If code and
this document disagree, the code is wrong. The database schema is
`backend/internal/database/migrations/00001_init.sql` (authoritative; do not edit it — add a new
migration if a change is truly required). `00002_token_version.sql` adds `users.token_version`
(access-token revocation, §3 Auth). `00003_relates_pairs_and_comment_activity.sql` adds a unique
index on the unordered pair of `relates` links and `activities.comment_id` (§2 Activity log).
`00004_nfc_emails.sql` brings stored e-mail addresses to Unicode NFC (§3 API conventions).

---

## 1. Stack & layout

| Layer     | Choice |
|-----------|--------|
| Backend   | Go 1.27, `github.com/go-chi/chi/v5`, `github.com/jackc/pgx/v5` (pgxpool), sqlc (pgx/v5 driver), `github.com/pressly/goose/v3` (embedded migrations), `github.com/golang-jwt/jwt/v5`, `golang.org/x/crypto/bcrypt`, `github.com/coder/websocket` |
| Database  | PostgreSQL 17 (docker compose service `db`, host port **5442**) |
| Frontend  | React 19 + TypeScript + Vite, Tailwind CSS v4, React Router v7, TanStack Query v5, dnd-kit, Radix UI primitives, lucide-react |

```
Gene Board/
  docker-compose.yml          # db (5442). geneboard + geneboard_test databases
  Makefile                    # db-up, backend, frontend, seed, test, ...
  docs/SPEC.md                # this file
  docs/FRONTEND.md            # frontend architecture & file ownership
  backend/
    go.mod                    # module geneboard
    sqlc.yaml
    cmd/server/main.go        # `server` (default: migrate + serve), `server migrate`, `server seed`
    queries/*.sql             # sqlc query files
    internal/
      config/                 # env config
      database/               # pgxpool + goose (//go:embed migrations/*.sql)
      database/migrations/    # goose SQL migrations (00001_init.sql is authoritative)
      db/                     # sqlc-generated code — DO NOT EDIT BY HAND
      auth/                   # JWT + bcrypt
      rank/                   # fractional-index rank strings
      realtime/               # websocket hub
      httpx/                  # JSON helpers, error envelope, Optional[T], middleware
      service/                # domain logic (permissions, validation, activity logging)
      api/                    # chi router + HTTP handlers + DTOs
  frontend/                   # Vite app (see docs/FRONTEND.md)
```

### Configuration (env vars)

| Var | Default |
|-----|---------|
| `DATABASE_URL` | `postgres://geneboard:geneboard@localhost:5442/geneboard?sslmode=disable` |
| `TEST_DATABASE_URL` | `postgres://geneboard:geneboard@localhost:5442/geneboard_test?sslmode=disable` |
| `BIND_HOST` | `127.0.0.1` — the listen address (loopback only, so other machines cannot reach a server run from source); container mode: all interfaces. `0.0.0.0` or `::` listens on all interfaces, which requires a `JWT_SECRET` of ≥ 32 characters. (Not `HOST`, which some shells and dev tools export for their own use.) |
| `PORT` | `8484` |
| `JWT_SECRET` | `dev-insecure-secret-change-me` (log a warning when default is used). It is published, so it is only accepted while `BIND_HOST` is a loopback address; a non-loopback `BIND_HOST` needs a secret of ≥ 32 characters. While it is in use the API also answers only requests addressed to a loopback host (`Host` localhost or a loopback IP; 403 `forbidden` otherwise), so a web page cannot reach it by rebinding its own host name to 127.0.0.1. Container mode (`GB_CONTAINER=1`, set by the API image) never uses this published default: without `JWT_SECRET` a random secret is generated at start-up (sign-ins end on restart), and a set secret must be ≥ 32 characters |
| `JWT_TTL` | `168h` |
| `CORS_ORIGINS` | `http://localhost:5173` (comma-separated) |
| `AUTH_RATE_LIMIT` | `20` — `POST /auth/login` + `/auth/register` requests and password changes (`PATCH /auth/me`) per client address per minute; `0` disables auth throttling (the e2e suite) |
| `TRUSTED_PROXIES` | `127.0.0.0/8,::1/128` (loopback: the Vite dev proxy); container mode adds the private networks `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7` (the compose nginx). Comma-separated IPs / CIDR prefixes of the reverse proxies whose `X-Real-IP` (else last `X-Forwarded-For` hop) names the client for auth throttling, or `none`; any other peer is throttled by its own address. A container that clients reach directly (no proxy in front, e.g. `docker run -p 8484:8484` on a LAN host) should set `none`, or LAN clients pick their own throttling key |
| `GB_CONTAINER` | unset — `1` in the API image (see `BIND_HOST`, `JWT_SECRET`, `TRUSTED_PROXIES`) |

The Vite dev server (port 5173) proxies `/api` (including websockets) to `http://127.0.0.1:8484`.

---

## 2. Domain model & rules

### Roles (per project)
| Role | Can |
|------|-----|
| `viewer` | read everything in the project |
| `member` | viewer + create/edit/delete/move issues, comments (own), links, labels (create only), sprints (create/edit/start/complete/delete) |
| `admin`  | member + edit/delete project, manage members, statuses (columns), labels (edit/delete), delete anyone's comment |

- Project creator becomes `admin` and project lead.
- Non-members get **404** for a project and anything inside it (don't leak existence). Members lacking the role get **403**.
- A project must always keep at least one admin (demoting/removing the last admin → 409 `conflict`).

### Issue types & hierarchy
- `epic` — top level. `parent` must be null. Never in a sprint (`sprintId` always null). Not shown on boards or backlog lists; shown in the Epics panel/page.
- `story`, `task`, `bug` — "standard" issues. `parent` is null or an **epic in the same project**.
- `subtask` — `parent` is **required** and must be a standard issue (story/task/bug) in the same project. A subtask's sprint always equals its parent's sprint: it is inherited on creation, cannot be set directly (400 if a different value is supplied), and whenever a standard issue's sprint changes (PATCH, move, sprint completion) all its subtasks are updated to the same sprint.
- Type changes are allowed only among `story`/`task`/`bug`. Changing to/from `epic` or `subtask` → 400.
- Deleting an issue deletes its subtasks; its other children (issues under a deleted epic) become parentless.

### Keys
Issue key = `<PROJECT KEY>-<n>`; `n` comes from `projects.issue_counter` incremented atomically in the same transaction (`UPDATE projects SET issue_counter = issue_counter + 1 WHERE id=$1 RETURNING issue_counter`). Project keys are immutable after creation. Issue-key lookups are case-insensitive (upper-case the input).

### Statuses (workflow / board columns)
- Every project has ≥ 1 status. New projects get: `To Do` (todo, pos 0), `In Progress` (in_progress, 1), `In Review` (in_progress, 2), `Done` (done, 3).
- Any status → any status transition is allowed.
- New issues default to the first status by position (unless `statusId` supplied).
- `resolvedAt` is set to now() when an issue moves into a `done`-category status (from a non-done one) and cleared when it moves out. Changing a status's category updates `resolved_at` of its issues accordingly.
- Statuses have an optional `wipLimit` (Kanban column limit; advisory — shown in UI, not enforced).

### Rank (ordering)
One global rank per issue within a project (like Jira's rank). All lists — backlog, sprint lists, board columns — are ordered by `rank ASC` (byte-wise; column has `COLLATE "C"`).
- `internal/rank` implements fractional indexing over the alphabet `0-9a-z` (byte order): `rank.Between(prev, next string) (string, error)` where `""` means unbounded. Must satisfy `prev < result < next` for all valid inputs, never produce a key ending in `'0'`, and be thoroughly unit-tested (including thousands of random insertions and repeated insertion at the same spot).
- New issues are ranked last in the project (`Between(maxRank, "")`).
- Moves (drag & drop) send the ids of the issues that will be immediately above (`prevIssueId`) and below (`nextIssueId`) the moved issue in the destination list; server computes `Between(prev.rank, next.rank)`. If only one neighbour is given, the other side is unbounded. If `prev.rank >= next.rank` (stale client), fall back to `Between(prev.rank, "")`. A neighbour id that is not an issue of this project (deleted since the client loaded its list, or of another project, so the response does not reveal whether an id exists) counts as not given; if neither remains, the rank is unchanged. The moved issue itself as a neighbour → 400.

### Sprints (Scrum projects)
States: `planned` → `active` → `completed`.
- Create: state `planned`; a missing name, or one with no visible character, gets the default name `"<KEY> Sprint <n>"` where n = (number of sprints ever created in project) + 1.
- Start: only `planned`; requires `startDate` and `endDate` (end ≥ start); only one `active` sprint per project (409 otherwise).
- Complete: only `active`. Issues in the sprint whose status category ≠ `done` ("open" issues) are moved to the target (`backlog`, an existing `planned` sprint of the same project, or a `new` sprint that gets created). Done issues remain in the completed sprint (and are not listed in the backlog; open issues later left in a completed sprint, e.g. reopened, are listed in the backlog). Subtasks follow their parent (rule above). Sets `state=completed`, `completed_at=now()`.
- Delete: only `planned` sprints (409 otherwise); their issues go to the backlog.
- Completed sprints are read-only (PATCH → 409).
- Epics can never be put in a sprint (400).

### Boards
- **Scrum** project board = non-epic issues (standard + subtasks) in the **active** sprint. If no active sprint, `sprint: null, issues: []`.
- **Kanban** project board = all non-epic issues, excluding done-category issues whose `resolvedAt` is older than 14 days.
- Columns = statuses ordered by position; issues are grouped client-side by `status.id`, ordered by rank.
- `parents` = the parents of subtasks on the board that are not on it themselves (a Kanban board can hide a long-resolved parent), so clients can still find a subtask's epic; they are never shown as cards.

### Activity log (`activities`)
Written in the same transaction as the change. `action` values:

| action | issue_id | field / old / new |
|--------|----------|-------------------|
| `issue.created` | yes | new_value = summary |
| `issue.updated` | yes | one row **per changed field**; field ∈ `summary, description, type, status, priority, assignee, reporter, parent, sprint, storyPoints, dueDate, labels`; old/new are human-readable (status name, user name, issue key, sprint name, comma-joined label names, `YYYY-MM-DD`); for `description` old/new are null |
| `issue.deleted` | null (issue_key kept) | new_value = summary |
| `comment.created` | yes (+ comment_id) | new_value = first 200 chars of the comment's **current** body, read when listed (not stored); null once the comment or its issue is deleted |
| `link.created` / `link.deleted` | yes (source issue) | new_value e.g. `blocks GB-7`; readers who are not members of the other issue's project get `blocks an issue in another project` |
| `sprint.created` / `sprint.started` / `sprint.completed` | null | new_value = sprint name |
| `project.created` | null | new_value = project name |
| `member.added` / `member.removed` | null | new_value = user name (+ ` (role)` for added) |

Rank-only moves are not logged. Status/sprint changes via the move endpoint are logged as `issue.updated`.

### Realtime
After any successful mutation inside a project, the server publishes an event to the project's websocket subscribers (after the DB transaction commits). Clients treat events as cache-invalidation hints. A link change also concerns the other issue's project: creating or deleting a link, and deleting an issue (with its subtasks) or a project, which removes its links, publish `issue.updated` for each linked issue of another project to that project.

---

## 3. API conventions

- Base path `/api`. JSON request/response bodies, `Content-Type: application/json`.
- Auth: `Authorization: Bearer <jwt>` on everything except `/api/health`, `/api/auth/register`, `/api/auth/login` (and the websocket, which takes `?token=`). JWT HS256, claims `sub` (user id as string), `exp`, `iat`, and `ver` (the user's token version; omitted when 0). A token is rejected (401) once its `ver` is no longer the user's current token version, which a password change increments (see `PATCH /auth/me`).
- JSON field names are **camelCase**. Ids are JSON numbers. Timestamps are RFC 3339 strings in UTC (e.g. `2026-09-24T10:15:00Z`). Dates are `YYYY-MM-DD` strings. Absent optional values are `null` (never omitted) in responses.
- **PATCH semantics**: a field absent from the body is left unchanged; a field explicitly `null` clears it (only for nullable fields). Implement with a generic `httpx.Optional[T]` (tracks `Set` and `Null`).
- Unknown JSON fields are ignored. Malformed JSON → 400 `bad_request`.
- Lists "ordered by name" (and issue search by `summary`) compare case-insensitively in the Unicode root collation (Postgres `"und-x-icu"`), so accented letters sort with their base letter ("Ärger" before "Zeta"), as in the UI.
- Validation: trim strings before validating. Names (of users, projects, sprints, columns and labels) are also brought to Unicode NFC and lose the invisible characters around them (zero-width spaces, BOMs, bidi controls), so they compare as they look; e-mail addresses are brought to NFC and must not contain invisible characters. Required text must contain a visible character (400 "is required" otherwise). Text containing NUL characters (`\u0000`) is rejected: 400 `validation_error` on the field in bodies, 400 `bad_request` in query strings and paths (which must also be valid UTF-8). A malformed query string (a bad `%` escape, a `;` separator) is 400 `bad_request` as well, never read without the broken parameter.
- Every request other than a websocket handshake (a GET with `Upgrade: websocket` and no body) must send its body within 30 s and read its response within 60 s.

### Error envelope
```json
{ "error": { "code": "validation_error", "message": "Summary is required", "fields": { "summary": "is required" } } }
```
`fields` is optional. Codes ↔ HTTP status:

| code | status |
|------|--------|
| `bad_request` | 400 (malformed JSON / bad query param) |
| `validation_error` | 400 |
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 (also when a request collides with a concurrent change, e.g. a row it refers to was deleted meanwhile) |
| `rate_limited` | 429 (too many sign-in or password-change attempts; `Retry-After` header says when to retry) |
| `internal` | 500 (never leak internals; log them) |

### Success status codes
`201` for creates (returns the created resource), `204` (no body) for deletes, `200` otherwise.

---

## 4. Resource shapes (TypeScript notation — JSON)

```ts
type ID = number;
type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'subtask';
type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';
type StatusCategory = 'todo' | 'in_progress' | 'done';
type Role = 'admin' | 'member' | 'viewer';
type ProjectType = 'scrum' | 'kanban';
type SprintState = 'planned' | 'active' | 'completed';
type LinkType = 'blocks' | 'relates' | 'duplicates' | 'clones';

interface User { id: ID; email: string; name: string; createdAt: string; }
interface UserSummary { id: ID; name: string; email: string; }

interface AuthResponse { token: string; user: User; }

interface Project {
  id: ID; key: string; name: string; description: string; type: ProjectType;
  lead: UserSummary | null;
  myRole: Role;                 // role of the calling user
  issueCount: number;           // total issues in project
  createdAt: string; updatedAt: string;
}

interface Member { user: UserSummary; role: Role; joinedAt: string; }

interface Status { id: ID; name: string; category: StatusCategory; position: number; wipLimit: number | null; }

interface Label { id: ID; name: string; color: string; }   // color "#RRGGBB"

interface Sprint {
  id: ID; projectId: ID; name: string; goal: string; state: SprintState;
  startDate: string | null; endDate: string | null; completedAt: string | null;
  issueCount: number;           // non-subtask, non-epic issues in the sprint
  pointsTotal: number;          // sum of storyPoints of those issues (null → 0)
  pointsDone: number;           // same, restricted to done-category status
  createdAt: string; updatedAt: string;
}

interface IssueRef {            // compact reference (parents, links, children in refs)
  id: ID; key: string; summary: string; type: IssueType;
  status: Status; priority: Priority;
}

interface Issue {
  id: ID; key: string; projectId: ID; projectKey: string;
  type: IssueType; summary: string; description: string;
  status: Status; priority: Priority;
  assignee: UserSummary | null; reporter: UserSummary | null;
  parent: IssueRef | null;
  sprint: { id: ID; name: string; state: SprintState } | null;
  labels: Label[];              // sorted by name
  storyPoints: number | null; dueDate: string | null;
  rank: string;
  subtaskCount: number;         // direct subtasks (0 for epics/subtasks)
  resolvedAt: string | null; createdAt: string; updatedAt: string;
}

interface IssueLink {
  id: ID; type: LinkType;
  direction: 'outward' | 'inward';   // relative to the issue being viewed
  label: string;                     // outward: "blocks" | "relates to" | "duplicates" | "clones"
                                     // inward:  "is blocked by" | "relates to" | "is duplicated by" | "is cloned by"
  issue: IssueRef;                   // the *other* issue
  createdAt: string;
}

interface IssueDetail extends Issue {
  children: Issue[];   // epic → its stories/tasks/bugs; standard issue → its subtasks; subtask → []. Ordered by rank.
  links: IssueLink[];  // ordered by createdAt
}

interface Comment {
  id: ID; issueId: ID; author: UserSummary | null; body: string;
  createdAt: string; updatedAt: string; edited: boolean;   // edited = updatedAt > createdAt
}

interface Activity {
  id: ID; projectId: ID; projectKey: string; issueId: ID | null; issueKey: string | null;
  actor: UserSummary | null; action: string;
  field: string | null; oldValue: string | null; newValue: string | null;
  createdAt: string;
}

interface EpicProgress {
  epic: Issue;
  total: number; done: number; inProgress: number;        // counts of child issues by status category
  pointsTotal: number; pointsDone: number;
}

interface Page<T> { items: T[]; total: number; limit: number; offset: number; }
```

---

## 5. Endpoints

All paths below are prefixed with `/api`. `{key}` = project key (case-insensitive), `{issueKey}` = issue key (case-insensitive). Unless stated, project-scoped reads need `viewer`, writes need `member`.

### Health & auth
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | – | `{ "status": "ok" }` |
| POST | `/auth/register` | `{ email, name, password }` (email valid, lower-cased; name 1–100; password ≥ 8 chars) | 201 `AuthResponse` (409 if email taken) |
| POST | `/auth/login` | `{ email, password }` | 200 `AuthResponse` (401 `unauthorized` "Invalid email or password") |
| GET | `/auth/me` | – | `User` |
| PATCH | `/auth/me` | `{ name?, currentPassword?, newPassword? }` (password change needs both; wrong current → 400 validation_error on `currentPassword`) | `AuthResponse` — the account and a token. A password change revokes every token issued before it (all sessions, the caller's too) and returns a fresh one, so clients switch to the returned token; any other update returns the caller's own token (only signing in or changing the password starts a session). Only the fields that change are written, so concurrent updates of the same account never undo each other. A request whose token a concurrent password change revoked answers 401 `unauthorized` and writes nothing; of two password changes racing each other, the later one answers 409 `conflict`, or 401 `unauthorized` when the earlier one had already committed as it read the account (either way it writes nothing; the earlier one already revoked its token). |

Register, login and password changes are throttled: `AUTH_RATE_LIMIT` requests per client address per minute, shared by the three; 10 failed logins per account; and 10 wrong `currentPassword`s per session (access token). The failure budgets refill at one a minute and are cleared by a successful login / password change. Over a limit the endpoints answer 429 `rate_limited` with `Retry-After`. The wrong-password budget is per session so that whoever holds a stolen token cannot lock the owner out of the password change that revokes it: signing in again starts a session with its own budget. An attempt counts against a failure budget before the password is checked (and is given back when it fails for another reason), so concurrent guesses cannot exceed it. Name-only `PATCH /auth/me` requests are not throttled.

### Users
| GET | `/users?query=&limit=20` | – | `UserSummary[]` — case-insensitive match on name or email (prefix/contains), max limit 50, ordered by name. Empty query returns first N users. By design any signed-in user can search the whole directory (the add-member picker must find people outside the caller's projects). |

### Projects
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/projects` | – | `Project[]` the caller is a member of, ordered by name |
| POST | `/projects` | `{ key, name, description?, type? }` key `^[A-Z][A-Z0-9]{1,9}$` (server upper-cases input first), name 1–80, description ≤ 4000, type default `scrum` | 201 `Project` (409 if key taken). Creates default statuses, admin membership, `project.created` activity |
| GET | `/projects/{key}` | – | `Project` |
| PATCH | `/projects/{key}` (admin) | `{ name?, description?, type?, leadId? }` (lead must be a member; null clears; description ≤ 4000) | `Project` |
| DELETE | `/projects/{key}` (admin) | – | 204 |

### Members
| GET | `/projects/{key}/members` | – | `Member[]` ordered by user name |
| POST | `/projects/{key}/members` (admin) | `{ email, role }` | 201 `Member` (404 no such user; 409 already member) |
| PATCH | `/projects/{key}/members/{userId}` (admin) | `{ role }` | `Member` (409 if it would leave no admin) |
| DELETE | `/projects/{key}/members/{userId}` (admin, or the user themself to leave) | – | 204 (409 if last admin). Removed user's assigned issues in the project become unassigned. |

### Statuses (columns)
| GET | `/projects/{key}/statuses` | – | `Status[]` by position |
| POST | `/projects/{key}/statuses` (admin) | `{ name, category, wipLimit? }` name 1–40 unique per project (case-insensitive → 409) | 201 `Status` appended at the end |
| PATCH | `/projects/{key}/statuses/{id}` (admin) | `{ name?, category?, wipLimit? }` | `Status` |
| PUT | `/projects/{key}/statuses/order` (admin) | `{ statusIds: ID[] }` — must be a permutation of all the project's status ids (400 otherwise) | `Status[]` |
| DELETE | `/projects/{key}/statuses/{id}?moveTo={statusId}` (admin) | – | 204. If issues use the status, `moveTo` (another status of the same project) is required (409 without it). Cannot delete the last status (409). Positions are re-compacted. |

### Labels
| GET | `/projects/{key}/labels` | – | `Label[]` by name |
| POST | `/projects/{key}/labels` (member) | `{ name, color? }` name 1–40, color `#RRGGBB` (default `#6B778C`) | 201 `Label` (409 duplicate name, case-insensitive) |
| PATCH | `/projects/{key}/labels/{id}` (admin) | `{ name?, color? }` | `Label` |
| DELETE | `/projects/{key}/labels/{id}` (admin) | – | 204 |

### Issues
| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/issues` | query params below | `Page<Issue>` |
| POST | `/projects/{key}/issues` | `CreateIssue` below | 201 `IssueDetail` |
| GET | `/issues/{issueKey}` | – | `IssueDetail` |
| PATCH | `/issues/{issueKey}` | `UpdateIssue` below | `IssueDetail` |
| DELETE | `/issues/{issueKey}` | – | 204 |
| POST | `/issues/{issueKey}/move` | `{ statusId?, sprintId?, prevIssueId?, nextIssueId? }` — `sprintId`: absent = unchanged, `null` = backlog | `Issue` |

`GET /issues` query params (all optional; comma-separated lists allowed where noted):
- `project` — project key; otherwise searches all the caller's projects
- `q` — text: matches `key` exactly (case-insensitive), or `summary`/`description` ILIKE `%q%`
- `type` (list), `statusId` (list), `statusCategory` (list), `priority` (list), `labelId` (list — issue has any)
- `assigneeId` — list of ids, may include `me` and/or `none`
- `reporterId` — ids and/or `me` (list)
- `sprintId` — id, `none` (backlog: no sprint), or `active`
- `parentId` — id (children of that issue); `epicId` is an alias
- `resolved` — `true`/`false`
- `sort` — `rank` (default) | `created` | `updated` | `priority` | `key` | `dueDate` | `summary`; `order` — `asc` | `desc` (default `asc` for rank/key/summary/dueDate/priority, `desc` for created/updated). `priority` asc = highest first. Ties broken by id.
- `limit` (default 50, max 200), `offset` (default 0)
Invalid values → 400 `bad_request`.

`CreateIssue`:
```ts
{ type: IssueType; summary: string;                 // summary 1–255
  description?: string;                             // ≤ 32767 characters
  statusId?: ID; priority?: Priority;               // default 'medium'
  assigneeId?: ID | null;                           // must be a project member
  reporterId?: ID | null;                           // default: caller; must be a member
  parentId?: ID | null;                             // hierarchy rules; subtask requires it
  sprintId?: ID | null;                             // planned/active sprint of same project; forbidden for epics; subtasks inherit the parent's (a value sent, null included, must match it)
  storyPoints?: number | null; dueDate?: string | null;
  labelIds?: ID[];                                  // labels of the same project
}
```
`UpdateIssue`: same fields, all optional (PATCH semantics); `labelIds` replaces the whole set. Same validation. Only changed fields produce activity rows. If nothing actually changes, no activity rows are written and `updatedAt` is unchanged.

Move semantics: see §2 Rank. Changing `sprintId` via move on a standard issue also moves its subtasks. Moving an epic or into a completed sprint → 400.

### Comments
| GET | `/issues/{issueKey}/comments` | – | `Comment[]` oldest first |
| POST | `/issues/{issueKey}/comments` | `{ body }` 1–10000 chars | 201 `Comment` |
| PATCH | `/comments/{id}` (author only) | `{ body }` | `Comment` |
| DELETE | `/comments/{id}` (author or project admin) | – | 204 |

### Links
| POST | `/issues/{issueKey}/links` | `{ type, targetKey }` (target must be accessible to caller; not the same issue; duplicate → 409, and for the symmetric `relates` the reverse link is a duplicate too — also when both are created at once) | 201 `IssueLink` (from the perspective of `{issueKey}`: direction `outward`) |
| DELETE | `/issue-links/{id}` (member of source issue's project) | – | 204 (404 if already deleted, also by a concurrent request; only one `link.deleted` is logged) |

### Activity
| GET | `/issues/{issueKey}/activity` | – | `Activity[]` newest first |
| GET | `/projects/{key}/activity?limit=50&offset=0` | – | `Activity[]` newest first (max 200; any non-negative offset) |
| GET | `/activity?limit=30` | – | `Activity[]` across all the caller's projects, newest first |

### Sprints
| GET | `/projects/{key}/sprints?state=planned,active` | – | `Sprint[]`: active first, then planned by id asc, then completed by completedAt desc |
| POST | `/projects/{key}/sprints` | `{ name?, goal?, startDate?, endDate? }` | 201 `Sprint` |
| GET | `/sprints/{id}` | – | `Sprint` |
| PATCH | `/sprints/{id}` | `{ name?, goal?, startDate?, endDate? }` | `Sprint` |
| DELETE | `/sprints/{id}` | – | 204 (planned only) |
| POST | `/sprints/{id}/start` | `{ startDate, endDate, name?, goal? }` | `Sprint` |
| POST | `/sprints/{id}/complete` | `{ target: 'backlog' \| 'sprint' \| 'new', sprintId?: ID }` | `{ sprint: Sprint, completedIssueCount: number, movedIssueCount: number, targetSprint: Sprint \| null }` |

Kanban projects: sprint endpoints return 400 `validation_error` ("Kanban projects do not use sprints") for create/start (also `complete` with target `new`). Their issues cannot be put into a sprint either: create / PATCH / move with a `sprintId` other than `null` and the issue's current sprint → 400 on `sprintId`; issues still in a sprint left over from Scrum can leave it (`null`), and subtasks keep sharing their parent's sprint.

### Board, backlog, epics
| GET | `/projects/{key}/board` | – | `{ project: Project, statuses: Status[], sprint: Sprint \| null, issues: Issue[], parents: Issue[] }` (§2 Boards; issues by rank; parents by id) |
| GET | `/projects/{key}/backlog` | – | `{ sprints: { sprint: Sprint, issues: Issue[] }[], backlog: Issue[] }` — sprints = active + planned (active first, planned by id); backlog = standard issues not in an active/planned sprint: those without a sprint (any status) and open issues left in completed sprints; done issues of completed sprints are excluded; issues exclude epics and subtasks; all by rank |
| GET | `/projects/{key}/epics` | – | `EpicProgress[]` ordered by epic rank |

### Realtime
`GET /api/projects/{key}/ws?token=<jwt>` — websocket upgrade (viewer+). Server → client text messages:
```json
{ "type": "issue.created" | "issue.updated" | "issue.deleted" | "issue.moved" | "comment.changed" | "sprint.changed" | "project.changed",
  "projectKey": "GB", "issueKey": "GB-12" | null, "actorId": 3 }
```
Server sends a ping every 30s; clients reconnect with backoff. Origin check must allow `CORS_ORIGINS`.

---

## 6. Seed data (`go run ./cmd/server seed`)
Idempotent-ish (skips if user `demo@geneboard.dev` exists; `seed --if-empty`, which `make up` runs, skips any database that has users). Creates users `demo@geneboard.dev` / `alex@geneboard.dev` / `sam@geneboard.dev` (password `password123`), a Scrum project `GB` "Gene Board" (all three members; demo admin) with 3 epics, ~15 stories/tasks/bugs spread over an active sprint, a planned sprint and the backlog, a few subtasks, labels, comments and a link; and a Kanban project `OPS` "Operations" with ~8 issues across columns.
