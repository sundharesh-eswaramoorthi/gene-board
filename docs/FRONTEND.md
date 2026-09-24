# Gene Board — Frontend architecture

React 19 + TypeScript (strict) + Vite, Tailwind CSS v4 (`@tailwindcss/vite`), React Router v7
(`react-router`, data-less `createBrowserRouter`), TanStack Query v5, dnd-kit (`@dnd-kit/core`,
`@dnd-kit/sortable`, `@dnd-kit/utilities`), Radix UI primitives (`radix-ui` or individual
`@radix-ui/react-*` packages), `lucide-react` icons, `react-markdown` + `remark-gfm`,
`date-fns`, `clsx` + `tailwind-merge`, `sonner` (toasts), `@fontsource-variable/inter`.

The API contract is `docs/SPEC.md` (§4 types, §5 endpoints). Dev server on **5173** proxies
`/api` (with `ws: true`) to `http://localhost:8484`.

Scripts in `frontend/package.json`: `dev`, `build` (`tsc -b && vite build`), `typecheck`
(`tsc -b --noEmit` or equivalent), `lint` (optional), `preview`.

---

## 1. Design system

Visual direction: clean, dense, Jira-like information design with its own identity —
neutral greys, one indigo-blue accent, 4px radii on controls / 8px on cards & panels, subtle
borders instead of heavy shadows, 13–14px base text, Inter.

**Colours are semantic tokens only.** They are CSS variables defined in `src/index.css`
(light values on `:root`, dark values on `.dark`) and exposed to Tailwind v4 through
`@theme inline`, so components use classes like `bg-surface text-fg border-border`.
Feature code must **never** use raw palette classes (`bg-blue-500`, `text-gray-600`) or hex
literals — except the fixed brand colours listed below via the helpers in `src/lib/`.

| Token (Tailwind name) | Use |
|---|---|
| `bg` | app background |
| `surface` | cards, panels, modals, inputs |
| `surface-sunken` | board columns, backlog sections, code blocks |
| `surface-hover` | hover row/card background |
| `surface-selected` | selected nav item / row |
| `border` / `border-strong` | hairlines / input borders |
| `fg` / `fg-muted` / `fg-subtle` | text: primary / secondary / tertiary |
| `primary` / `primary-hover` / `primary-fg` / `primary-subtle` | accent (buttons, links, focus, selected) |
| `danger` / `danger-subtle`, `success` / `success-subtle`, `warning` / `warning-subtle` | states |
| `ring` | focus ring |

Dark mode: `@custom-variant dark (&:where(.dark, .dark *));` — a theme toggle in the user
menu stores `light | dark | system` in localStorage (`gb-theme`) and toggles `.dark` on `<html>`.

Fixed brand colours (same in both themes, exposed via `src/lib/issueMeta.ts`):
- Issue types — epic `#904EE2` (Zap icon), story `#63BA3C` (Bookmark), task `#4BADE8` (CheckSquare), bug `#E5493A` (Bug / circle), subtask `#4BADE8` (small ListChecks / CornerDownRight).
- Priorities — highest `#CD1317` (ChevronsUp), high `#E9494A` (ChevronUp), medium `#E97F33` (Equal), low `#2D8738` (ChevronDown), lowest `#57A55A` (ChevronsDown).
- Status lozenges — todo: neutral grey, in_progress: blue, done: green (uppercase, 11px bold, like Jira) — use tokens that work in both themes.
- Avatars — deterministic colour from user id over a fixed 8-colour list; initials.
- Epic chips — deterministic colour from epic id over the same kind of list.

---

## 2. Source layout & shared contracts (built by the foundation agent)

```
src/
  main.tsx                    # QueryClientProvider, AuthProvider, ThemeProvider, RouterProvider, Toaster
  index.css                   # tailwind import, tokens, base styles
  app/router.tsx              # all routes (below)
  app/ModalsProvider.tsx      # issue modal + create-issue modal host & hooks
  api/client.ts               # fetch wrapper + ApiError
  api/types.ts                # every type from SPEC §4, verbatim
  api/queryKeys.ts            # qk factory (below)
  api/{auth,users,projects,members,statuses,labels,issues,comments,links,activity,sprints,board}.ts  # hooks
  auth/AuthProvider.tsx       # useAuth(), RequireAuth
  components/ui/*             # primitives
  components/issue/*          # issue-domain display + pickers
  components/layout/*         # AppLayout, TopNav, ProjectLayout, ProjectSidebar
  lib/*                       # cn, dates, colours, issueMeta, projectKeyOf, ...
  realtime/useProjectRealtime.ts
  pages/auth/{LoginPage,RegisterPage}.tsx
  pages/NotFoundPage.tsx
  features/**                 # owned by feature agents (see §4)
```

### API client (`src/api/client.ts`)
`api.get<T>(path, params?)`, `api.post<T>(path, body?)`, `api.patch<T>`, `api.put<T>`,
`api.delete(path)`. Paths are relative to `/api` (e.g. `api.get<Project[]>('/projects')`).
`params` is `Record<string, string | number | boolean | (string|number)[] | null | undefined>` —
arrays are joined with commas, null/undefined dropped. Adds `Authorization` from the stored token
(`localStorage['gb-token']`). Non-2xx → throws `ApiError { status, code, message, fields? }`.
A 401 on any request except login/register clears the session and redirects to
`/login?next=<current path>`. 204 → `undefined`.

### Query keys (`src/api/queryKeys.ts`)
Everything project-scoped lives under `['project', KEY, ...]` so that
`invalidateQueries({ queryKey: ['project', KEY] })` refreshes the whole project (used by
realtime and by mutations). Issue keys derive the project with `projectKeyOf('GB-12') === 'GB'`.
```ts
qk.me()                        // ['me']
qk.users(query)                // ['users', query]
qk.projects()                  // ['projects']
qk.project(key)                // ['project', key]
qk.board(key)                  // ['project', key, 'board']
qk.backlog(key)                // ['project', key, 'backlog']
qk.epics(key)                  // ['project', key, 'epics']
qk.statuses(key) / labels(key) / members(key) / sprints(key)
qk.projectActivity(key)        // ['project', key, 'activity']
qk.issue(issueKey)             // ['project', projectKeyOf(issueKey), 'issue', issueKey]
qk.comments(issueKey)          // [...qk.issue(issueKey), 'comments']
qk.issueActivity(issueKey)     // [...qk.issue(issueKey), 'activity']
qk.issues(params)              // ['issues', params]           (search / lists)
qk.activityFeed()              // ['activity']
```
Mutation hooks invalidate `['project', KEY]`, `['issues']`, and `['activity']` on success (and
`['projects']` when project data/counts change). Mutation hooks do **not** do optimistic updates;
board/backlog implement optimistic drag-and-drop locally.

Hook names (all in `src/api/*.ts`, TanStack Query v5):
`useMe, useUpdateMe, useUsers(query)`, `useProjects, useProject(key), useCreateProject, useUpdateProject(key), useDeleteProject(key)`,
`useMembers(key), useAddMember(key), useUpdateMember(key), useRemoveMember(key)`,
`useStatuses(key), useCreateStatus(key), useUpdateStatus(key), useReorderStatuses(key), useDeleteStatus(key)`,
`useLabels(key), useCreateLabel(key), useUpdateLabel(key), useDeleteLabel(key)`,
`useIssues(params, options?), useIssue(issueKey), useCreateIssue(), useUpdateIssue(issueKey), useDeleteIssue(), useMoveIssue()`,
`useComments(issueKey), useAddComment(issueKey), useUpdateComment(issueKey), useDeleteComment(issueKey)`,
`useCreateLink(issueKey), useDeleteLink(issueKey)`,
`useIssueActivity(issueKey), useProjectActivity(key, limit?), useActivityFeed(limit?)`,
`useSprints(key, states?), useCreateSprint(key), useUpdateSprint(key), useDeleteSprint(key), useStartSprint(key), useCompleteSprint(key)`,
`useBoard(key), useBacklog(key), useEpics(key)`.

### Modals (`src/app/ModalsProvider.tsx`)
```ts
useIssueModal(): { openIssue(issueKey: string): void; closeIssue(): void; currentIssueKey: string | null }
// implemented with the `?issue=GB-12` search param on the current URL (shareable, back-button friendly)

interface CreateIssueDefaults {
  projectKey?: string; type?: IssueType; parentId?: number; parentKey?: string;
  parentType?: IssueType;   // lets the form infer the issue type before the parent loads
  sprintId?: number | null; statusId?: number; summary?: string;
  onCreated?: (issue: IssueDetail) => void;
}
useCreateIssueModal(): { openCreateIssue(defaults?: CreateIssueDefaults): void }
```
The provider renders (props are a fixed contract):
```tsx
// src/features/issue/IssueDetailModal.tsx   (owned by the issue agent)
export function IssueDetailModal(props: { issueKey: string; onClose: () => void }): JSX.Element
// src/features/issue/CreateIssueModal.tsx   (owned by the issue agent)
export function CreateIssueModal(props: { open: boolean; defaults: CreateIssueDefaults; onClose: () => void }): JSX.Element
```
`CreateIssueDefaults` is exported from `src/app/ModalsProvider.tsx`.

### Shared components the foundation provides
- `components/ui/`: `Button` (variants `primary | secondary | subtle | danger | link`, sizes `sm | md`, `loading`), `IconButton`, `Input`, `Textarea`, `Select` (native, styled), `Field` (label + hint + error), `Dialog` (Radix; `size: sm | md | lg | xl`), `ConfirmDialog`, `DropdownMenu`, `Popover`, `Tooltip`, `Tabs`, `Badge`, `Spinner`, `EmptyState`, `Skeleton`, `Kbd`, `toast` re-export.
- `components/issue/`: `IssueTypeIcon`, `PriorityIcon`, `StatusLozenge`, `LabelChip`, `UserAvatar` (user | null → "Unassigned"), `IssueKeyLink` (opens modal), `EpicChip`, and pickers usable in forms *and* inline editing: `TypeSelect`, `StatusSelect(projectKey)`, `PrioritySelect`, `UserPicker(projectKey)` (project members, searchable, "Unassigned"), `LabelMultiSelect(projectKey)` (search + create new label), `SprintSelect(projectKey)` (planned/active + "Backlog"), `ParentPicker(projectKey, childType)` (epics for standard issues, standard issues for subtasks; searchable).
- `components/layout/`: `AppLayout` (TopNav + `<Outlet/>`), `TopNav` (logo "Gene Board", Your work, Projects dropdown, Issues, search box → `/issues?q=` (an exact issue key opens that issue instead), **Create** button → `openCreateIssue({ projectKey: current })`, theme toggle + user menu with logout), `ProjectLayout` (sidebar + outlet; loads project, subscribes realtime, 404 state), `ProjectSidebar` (project avatar/name/type; nav: Board, Backlog (for Kanban the flat ranked list of §3), Epics, Issues, Activity, Project settings).
- `realtime/useProjectRealtime(key)`: websocket to `/api/projects/{key}/ws?token=…`, on message invalidates `['project', key]` + `['issues']` (debounced ~300ms), reconnect with exponential backoff, closes on unmount.

### Routes (`src/app/router.tsx`)
| Path | Component (named export) | File |
|---|---|---|
| `/login`, `/register` | `LoginPage`, `RegisterPage` | `pages/auth/*` |
| `/` (auth) | `DashboardPage` | `features/dashboard/DashboardPage.tsx` |
| `/projects` | `ProjectsPage` | `features/projects/ProjectsPage.tsx` |
| `/issues` | `IssuesPage` | `features/search/IssuesPage.tsx` |
| `/browse/:issueKey` | `IssuePage` | `features/issue/IssuePage.tsx` |
| `/projects/:projectKey` → `ProjectLayout`; index redirects to `board` | | |
| `…/board` | `BoardPage` | `features/board/BoardPage.tsx` |
| `…/backlog` | `BacklogPage` | `features/backlog/BacklogPage.tsx` |
| `…/epics` | `EpicsPage` | `features/epics/EpicsPage.tsx` |
| `…/issues` | `IssuesPage` (reads `projectKey` param → scoped) | `features/search/IssuesPage.tsx` |
| `…/activity` | `ProjectActivityPage` | `features/activity/ProjectActivityPage.tsx` |
| `…/settings` | `ProjectSettingsPage` | `features/settings/ProjectSettingsPage.tsx` |
| `*` | `NotFoundPage` | `pages/NotFoundPage.tsx` |

All authenticated routes sit under `RequireAuth` + `AppLayout`. Pages take no props (read
params via hooks). The foundation creates each feature file as a minimal placeholder with the
exact named export so the app builds before features land.

---

## 3. UX requirements per feature

**Board** — columns = statuses (header: name, count, WIP `n/limit` turning `danger` when exceeded). Cards: type icon, summary (2-line clamp), key, priority icon, story points pill, assignee avatar, epic chip, label chips (max 2 + "+n"), subtask parent key for subtasks. Drag cards within/between columns (dnd-kit, keyboard sensor too) with optimistic update → `POST /issues/{key}/move` with `statusId`, `prevIssueId`, `nextIssueId` (neighbours inside the destination column); revert + toast on failure. Toolbar: search, assignee avatar quick-filters, "Only my issues", type filter, epic filter, "hide subtasks", clear filters. Scrum header: sprint name, goal, dates, days remaining, **Complete sprint** dialog (shows done/open counts, choose target: backlog / planned sprint / new sprint; lists open subtasks of done issues, which stay in the completed sprint). No active sprint → empty state linking to Backlog. Click card → `openIssue(key)`. "+ Create issue" at the bottom of the first column.

**Backlog** (scrum) — stacked collapsible sections: active sprint, planned sprints, then Backlog. Section header: name, dates, issue count, points by category (todo/in progress/done pills), actions (Start sprint dialog — name, goal, start/end dates with 1/2/3/4-week presets; Complete sprint for active → the board's Complete sprint dialog, shown in place so the next sprint can be started right away; Edit sprint; Delete sprint with confirm). Compact rows: type icon, key, summary, epic chip, labels, status lozenge, points, priority, assignee. Drag rows to reorder and between sections (optimistic; `move` with `sprintId` + neighbours). Inline "+ Create issue" per section (quick create: type + summary, Enter to save). "Create sprint" button. Left collapsible **Epics** panel listing epics with progress; selecting one filters rows; "Issues without epic" option. Search box + assignee filters. Kanban projects: show a flat ranked list (no sprints) and a hint, plus Complete / Delete for sprints left over from when the project used Scrum.

**Epics page** — epic cards/rows with colour chip, key, summary, status, progress bar (done / in progress / todo), points done/total, due date; expand to show children; "Create epic".

**Issue detail** (modal + full page share one `IssueView` component) — header breadcrumb (project › parent › key) + actions (copy link, open in full page, delete with confirm). Left: inline-editable summary; description (Markdown view; click to edit with textarea, Save/Cancel, preview tab); child issues section (list + progress bar + inline create: subtasks for standard issues, stories/tasks/bugs for epics); linked issues (grouped by label, add link: type + issue search, remove); activity tabs **Comments** (add with Ctrl/Cmd+Enter, edit/delete own, markdown) / **History** (activity rows rendered as sentences). Right panel: status select (prominent, coloured), assignee (+ "Assign to me"), reporter, priority, labels, sprint (not for epics/subtasks), parent/epic, story points, due date, created/updated/resolved timestamps. Every field edit → `PATCH` with only that field; show errors via toast. Viewer role → read-only. Leaving the modal (Escape, overlay, close button, Back, another issue) with an unsaved description or comment asks to discard it.

**Create issue modal** — project select (defaults to current), type, summary (required), description, priority, assignee, labels, parent (epic / parent for subtasks — required for subtask), sprint (scrum; hidden for epic/subtask), story points, due date. "Create another" checkbox. On success: toast with key link, call `defaults.onCreated`.

**Projects** — table/cards of my projects (key, name, type, lead, issue count) + **Create project** dialog (name, key auto-suggested from name — uppercase initials, editable, validated live; type scrum/kanban with descriptions; description).

**Project settings** — tabs: *Details* (name, description, type, lead; delete project with type-the-key confirm), *Members* (list, add by email with role, change role, remove; leave project), *Columns* (statuses: drag to reorder, rename inline, category select, WIP limit, add, delete with "move issues to" chooser), *Labels* (list with colour swatches, create, rename, recolour, delete). Non-admins see read-only views.

**Issues / search page** — filter bar (text, type, status, priority, assignee incl. me/unassigned, reporter incl. me, label, epic, sprint incl. backlog/active, resolved) synced to URL query params; project filter on the global route (picking a project there enables that project's statuses, members, labels, epics and sprints); sortable table columns (key, summary, type, status, priority, assignee, created, updated, due); pagination (50/page); click row → `openIssue`.

**Your work (dashboard)** — greeting, "Assigned to me" (open issues across projects, grouped by project or sorted by priority), recent projects cards, recent activity feed across projects.

**Project activity** — timeline of activity rows grouped by day, rendered as sentences ("Alex changed status of GB-12 from To Do to In Progress"), load more.

Empty, loading (skeletons) and error states everywhere. Every page must be usable at 1280px and not break at 768px.

---

## 4. File ownership (parallel build)

| Agent | Owns (may create/edit only these) |
|---|---|
| foundation | everything under `frontend/` except `src/features/**` (but creates the placeholder files listed in §2 routes and `features/issue/{IssueDetailModal,CreateIssueModal}.tsx`) |
| board | `src/features/board/**` |
| backlog | `src/features/backlog/**`, `src/features/epics/**` |
| issue | `src/features/issue/**` |
| workspace | `src/features/{dashboard,projects,search,activity,settings}/**` |

Feature agents must not edit files outside their paths. Missing shared helper? Write a local one in
your feature folder. Found a real bug in shared code? Work around it locally and report it.

### Test ids (used by Playwright e2e)
- Board column: `data-testid="board-column-<statusId>"`; card: `data-testid="issue-card-<ISSUE-KEY>"`.
- Backlog section: `data-testid="backlog-section-<sprintId>"` or `backlog-section-backlog`; row: `data-testid="backlog-row-<ISSUE-KEY>"`.
- Issue view root: `data-testid="issue-view"`; summary: `issue-summary`; status select: `issue-status`.
- Create issue modal: `data-testid="create-issue-modal"`; summary input: `create-issue-summary`; submit: `create-issue-submit`.
- Top nav create button: `data-testid="nav-create-issue"`.
