# Gene Board end-to-end tests

Playwright tests that drive the real app in Chromium: the Go API and the Vite dev server,
started by the suite itself.

```sh
make e2e                    # install if needed, then run everything (needs `make db-up`)
make e2e ARGS='-g board'    # extra Playwright flags
make e2e-ui                 # Playwright's UI runner
```

Or from this folder: `npm test`, `npm run test:flows` (flows only, no screenshots),
`npm run screenshots`, `npm run typecheck`.

## Isolation

The suite never touches the dev database or a developer's running servers:

- **API on :8491**, started by `scripts/start-api.mjs`. It drops and recreates the database
  `geneboard_e2e`, builds the server into `.cache/`, migrates, seeds the demo data and serves.
  The name must end in `_e2e`; override with `E2E_DATABASE_URL`. The server log is written to
  `.cache/api.log`, and global teardown fails the run if the API logged any error. Sign-in
  throttling is off there (`AUTH_RATE_LIMIT=0`): the tests register and sign in many accounts
  from one address.
- **Vite on :5174** with `GB_API_URL=http://127.0.0.1:8491`, and its own dependency cache
  (`frontend/node_modules/.vite-e2e`).
- `reuseExistingServer` is off: if either port is taken, the run stops instead of testing
  someone else's server.

## Layout

- `tests/visual/` (project `visual`, runs first on the pristine seed): screenshots of every main
  screen at 1440×900, light and dark, into `screenshots/`. Each shot also checks that loading
  finished and the page has no horizontal overflow.
- `tests/flows/` (project `e2e`): user flows. Each test registers its own user and creates
  uniquely keyed projects through the API, so tests run in parallel and can be re-run against
  the same database. Only `kanban-realtime.spec.ts` uses the seeded OPS project (serially,
  restoring what it moves).
- `support/fixtures.ts`: `owner` (fresh account), `demo`, `newUser`, `loginAs`, and `openAs`
  (a browser context signed in as someone). Every page fails its test on uncaught errors,
  `console.error` or a 5xx from the API.
- `support/ui.ts`: `dragTo` (dnd-kit needs real mouse movement: press, pass the 5px activation
  distance, glide in steps, release; it waits for the drag to start and accepts a `beforeDrop`
  check), `pickOption` for the pickers, `fieldControl` for a form field by its label.

Drag-and-drop semantics to keep in mind when writing drags: hovering a row or card takes its
slot (the sortable preview shows where it lands); to append to a list, drop below its last row.
