# Gene Board

A Jira-style project tracker: projects, epics → stories / tasks / bugs → subtasks, Scrum boards
with sprints and a backlog, Kanban boards, drag and drop, comments, labels, issue links, search,
an activity history, roles, and live updates between users.

| Layer | Stack |
|---|---|
| API | Go 1.27 · chi · sqlc + pgx/v5 · goose migrations · JWT · websockets (`backend/`) |
| Web | React 19 · TypeScript · Vite · Tailwind CSS v4 · TanStack Query · dnd-kit · Radix UI (`frontend/`) |
| Data | PostgreSQL 17 in Docker |
| Tests | Go integration tests against a real database · Playwright end-to-end suite (`e2e/`) |

The contract between API and UI lives in [docs/SPEC.md](docs/SPEC.md) (domain rules + every
endpoint) and [docs/FRONTEND.md](docs/FRONTEND.md) (UI architecture, design system, UX).

---

## Run it

Requirements: Docker Desktop, plus Go 1.27+ and Node 22+ for the `make` targets that run from source.

```sh
make up            # build + start db, api and web containers
open http://localhost:8485
```

| Account | Password | Role in GB and OPS |
|---|---|---|
| `demo@geneboard.dev` (Demo User) | `password123` | admin |
| `alex@geneboard.dev` (Alex Rivera) | `password123` | member |
| `sam@geneboard.dev` (Sam Patel) | `password123` | member |

Demo data: **GB "Gene Board"** (Scrum; a completed sprint, an active sprint, a planned sprint,
a backlog, 3 epics, subtasks, labels, comments, links) and **OPS "Operations"** (Kanban).

| Command | What it does |
|---|---|
| `make up` | Build and start everything (containers restart automatically with Docker) |
| `make down` | Stop the app containers (the database keeps running, data is kept) |
| `make demo-reset` | Wipe everything back to the fresh demo data (~10 s) |
| `make help` | All targets |

Ports: web **8485** · API 8484 (loopback only) · Postgres 5442 (loopback only).
Sessions are signed with `JWT_SECRET` from `.env` (git-ignored, generated locally); keep it so
sign-ins survive container restarts.

---

## Things to try

1. **Your work** (home): issues assigned to you, recent projects, activity from teammates.
2. **Board** (GB → Board): drag cards between columns and within a column; use the filters
   (search, avatars, *Only my issues*, type, epic, hide subtasks); watch the WIP counts.
3. **Live updates**: open a private window, sign in as `alex@…`, open the same board, and move a
   card in one window — it moves in the other without a reload.
4. **Issue view**: click a card. Edit the summary, the Markdown description, status, assignee
   (*Assign to me*), priority, labels (type a new one to create it), story points, due date,
   parent/epic. Add a comment (⌘/Ctrl+Enter), link another issue, check the History tab.
   ⤢ opens the full page (`/browse/GB-…`).
5. **Create**: the top-bar **Create** button. Try an epic, a story inside it (or from the
   epic's *Child issues* section), then a subtask from the story's *Subtasks* section. Keys
   increment per project.
6. **Backlog** (GB → Backlog): drag issues between the active sprint, the planned sprint and
   the backlog, and reorder them; quick-create a row inside a section; filter by epic in the
   left panel. **Complete sprint** on GB Sprint 2 (choose where open issues go), then
   **Start sprint** on GB Sprint 3.
7. **Epics** page: progress bars; expand an epic to see its children.
8. **Search**: the top search box — type `GB-12` to jump straight to an issue, or words to
   search. The **Issues** page has filters (type, status, priority, assignee, reporter, label,
   sprint, epic, resolved) that stay in the URL, so filtered views can be bookmarked.
9. **Project settings** (as demo): *Members* — make Sam a **viewer**, sign in as Sam, and see
   everything become read-only. *Columns* — add, rename, reorder, set a WIP limit, delete a
   column (you'll be asked where its issues go). *Labels* — create, rename, recolour.
10. **Kanban**: the OPS board works the same way, without sprints.
11. **Your own project**: *Projects → Create project* (Scrum or Kanban); the key is suggested
    from the name.
12. **Dark mode**: avatar menu (top right) → Theme.

`make demo-reset` puts everything back afterwards.

---

## Develop

```sh
make install       # Go modules + frontend npm packages
make db-up         # Postgres only
make dev           # API on :8484 (from source) + Vite on :5173 with hot reload; Ctrl-C stops both
make seed          # demo data (skips if already seeded)
```

`make dev` and `make up` both use port 8484 — run `make down` before `make dev`.
Backend conventions (adding endpoints, queries, migrations): [backend/README.md](backend/README.md).

## Test

```sh
make test-backend   # Go unit + DB-backed integration tests (uses the geneboard_test database)
make check-frontend # TypeScript + lint
make e2e            # Playwright: 42 browser tests + screenshots in e2e/screenshots/
```

The e2e suite starts its own API (:8491) and Vite (:5174) against a throwaway `geneboard_e2e`
database, so it never touches your demo data or running servers. Details: [e2e/README.md](e2e/README.md).

---

## Layout

```
backend/    Go API — cmd/server (serve | migrate | seed), internal/{api,service,db,httpx,auth,rank,realtime,ratelimit,seed}
frontend/   React app — src/{api,app,auth,components,features,lib,realtime}; nginx config + Dockerfile for the container
e2e/        Playwright suite (flows + visual)
docs/       SPEC.md (API + domain contract), FRONTEND.md (UI architecture)
docker/     Postgres init script (creates geneboard_test)
```

## Known limitations

- No attachments, email notifications, time tracking, custom fields, workflow transition rules
  or sprint reports (burndown/velocity) yet.
- Any signed-in user can search the user directory (needed to add members by email) — by design.
- Sign-in throttling is in memory, per API process.
- Search results sorted by type, status or assignee are sorted in the browser (up to 1000 matches).
- Date inputs follow the operating system's date format.
- In the issue view's details panel, a long epic name is truncated at some widths.
