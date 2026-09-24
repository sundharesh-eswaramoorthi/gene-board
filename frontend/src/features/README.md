# Shared building blocks for feature agents

Everything outside `src/features/**` is owned by the foundation. Import it, don't edit it.
If something is missing, write a local helper in your own feature folder; report real bugs.
No new npm packages. Installed: react 19, react-router 7, @tanstack/react-query 5,
@dnd-kit/{core,sortable,utilities,modifiers}, radix-ui, lucide-react, react-markdown +
remark-gfm, date-fns 4, clsx, tailwind-merge, sonner, @fontsource-variable/inter.

Checks (safe to run concurrently): `npm run typecheck` · `npm run lint` (oxlint).
`npm run build` writes `dist/` and `node_modules/.tmp`, so don't run it in parallel.
UI playground in dev: **`/dev/ui`** renders every primitive and picker (source:
`src/pages/dev/UiShowcasePage.tsx`, a good place to copy usage from).
`GB_API_URL=http://host:port npm run dev` points the `/api` proxy at another backend.

---

## 1. Ground rules

- **Colours are semantic tokens only** (see §8). The stock Tailwind palette is **disabled**, so
  `bg-blue-500` / `text-gray-600` produce **no CSS at all**. Hex colours only come from
  `src/lib` helpers (issue types, priorities, avatars, epics, labels).
- Radii: controls `rounded-sm` (4px), cards/panels `rounded-lg` (8px). Hairline borders
  (`border-border`), and use shadows only for elevation (`shadow-card`, `shadow-raised`, `shadow-overlay`).
- Base text is 14px (`text-sm`). Use `text-xs` (12) for secondary text and `text-2xs` (11) for lozenges and meta.
- Pages take no props. Read params with `useParams()`. Inside `/projects/:projectKey/*`, use
  `useCurrentProject()` to get the loaded `Project` (the layout already handles 404/loading).
- Layout: `<main>` (and the project content pane) is a **full-height scroll container**. A page
  can use `h-full flex flex-col` to lay out a board with its own scrolling columns.
  Normal pages: `<PageContainer><PageHeader …/>…</PageContainer>`.
- Test ids (Playwright) from FRONTEND.md §4 are yours to add in your components.

### Gotchas
- **Radix `asChild` + React Router `NavLink`:** Slot only merges *string* classNames. Don't put a
  `NavLink` whose `className` is a function inside `Tooltip`, `DropdownMenuItem asChild`,
  `Button asChild`, and so on. Use `Link` and compute the active state with `useMatch`.
- Menu items fire **`onSelect`**, not `onClick`.
- `Dialog` focuses the element marked **`data-autofocus`** first. Without one it focuses the
  first input, textarea or select in the body. React's `autoFocus` does not work inside Radix dialogs.
- `IssueKeyLink` and `EpicChip interactive` stop click and pointerdown propagation, so you can use
  them inside clickable or draggable cards and rows.
- `useHotkey` single-key shortcuts are paused while a dialog, menu, popover or listbox is open, and while typing.
  Global shortcuts already taken: **`c`** (create issue) and **`/`** (focus search).

---

## 2. API layer — `@/api` (barrel) or `@/api/<file>`

```ts
import { useIssue, useUpdateIssue, qk, api, ApiError, type Issue } from '@/api'
```

- `api.get<T>(path, params?, { signal }?)`, `api.post<T>(path, body?)`, `api.patch<T>`,
  `api.put<T>`, `api.delete(path, params?)`. Paths are relative to `/api`. Arrays in `params`
  are comma-joined, and null, undefined and `''` are dropped. A 204 resolves to `undefined`.
- Errors: **`ApiError { status, code, message, fields? }`** (network failure: `status 0`,
  `code 'network_error'`). TanStack's `error` is typed `ApiError` everywhere. A 401 logs the user
  out and redirects to `/login?next=…` automatically.
- `qk` is the query-key factory (all keys are upper-cased; project-scoped keys sit under `['project', KEY]`):
  `qk.me() qk.users(q) qk.projects() qk.project(key) qk.board(key) qk.backlog(key) qk.epics(key)
  qk.statuses(key) qk.labels(key) qk.members(key) qk.sprints(key, states?) qk.projectActivity(key)
  qk.issue(issueKey) qk.comments(issueKey) qk.issueActivity(issueKey) qk.issues(params?) qk.activityFeed()`.
- `invalidateProject(qc, key | keys, { projects? })` is the standard refresh:
  `['project', KEY]` + `['issues']` + `['activity']` (+ `['projects']`).
- **Every mutation hook runs that refresh on success, and the mutation promise resolves only after
  the active queries have refetched.** So `await mutateAsync()` means the cache is fresh: drop your
  optimistic board state at that point and nothing flickers. Mutation hooks never update
  optimistically. Board and backlog DnD should update `qc.setQueryData(qk.board(key), …)` or local
  state themselves, and revert plus `toastError(err)` on failure.
- Query hooks accept an optional last `options` argument (`QueryOptions<T>`: `enabled`,
  `placeholderData`, `staleTime`, `select`…). Hooks whose key argument is `null`/`undefined`/`''`
  are disabled.

| Hook | Variables / args → data |
|---|---|
| `useMe()` / `useUpdateMe()` | → `User` / `{ name?, currentPassword?, newPassword? }` → `User` |
| `useUsers(query, { limit? })` | → `UserSummary[]` (all users; for adding members) |
| `useProjects()` · `useProject(key)` | → `Project[]` · `Project` |
| `useCreateProject()` | `{ key, name, description?, type? }` → `Project` |
| `useUpdateProject(key)` · `useDeleteProject(key)` | `{ name?, description?, type?, leadId? }` → `Project` · `void` |
| `useMembers(key)` | → `Member[]` |
| `useAddMember(key)` · `useUpdateMember(key)` · `useRemoveMember(key)` | `{ email, role }` · `{ userId, role }` · `userId` |
| `useStatuses(key)` | → `Status[]` (by position) |
| `useCreateStatus(key)` · `useUpdateStatus(key)` | `{ name, category, wipLimit? }` · `{ id, name?, category?, wipLimit? }` |
| `useReorderStatuses(key)` · `useDeleteStatus(key)` | `statusIds: ID[]` → `Status[]` · `{ id, moveTo? }` |
| `useLabels(key)` · `useCreateLabel(key)` | → `Label[]` · `{ name, color? }` → `Label` |
| `useUpdateLabel(key)` · `useDeleteLabel(key)` | `{ id, name?, color? }` · `id` |
| `useIssues(params, options?)` | `IssueSearchParams` → `Page<Issue>` (use `placeholderData: keepPreviousData` for tables) |
| `useIssue(issueKey)` | → `IssueDetail` |
| `useCreateIssue()` | `{ projectKey, type, summary, …CreateIssueInput }` → `IssueDetail` |
| `useUpdateIssue(issueKey)` | `UpdateIssueInput` (send **only changed fields**; `null` clears) → `IssueDetail` |
| `useDeleteIssue()` | `issueKey` → `void` (drops the issue's cache; close the modal) |
| `useMoveIssue()` | `{ issueKey, statusId?, sprintId? (null = backlog), prevIssueId?, nextIssueId? }` → `Issue` |
| `useComments(issueKey)` · `useAddComment(issueKey)` | → `Comment[]` · `body: string` → `Comment` |
| `useUpdateComment(issueKey)` · `useDeleteComment(issueKey)` | `{ id, body }` · `id` |
| `useCreateLink(issueKey)` · `useDeleteLink(issueKey)` | `{ type, targetKey }` → `IssueLink` · `IssueLink \| id` |
| `useIssueActivity(issueKey)` | → `Activity[]` (newest first) |
| `useProjectActivity(key, limit = 50)` | → `Activity[]` (keeps the previous rows while `limit` grows) |
| `useProjectActivityInfinite(key, pageSize = 50)` | infinite query. `data.pages.flat()`, `fetchNextPage`, `hasNextPage` |
| `useActivityFeed(limit = 30)` | → `Activity[]` across my projects |
| `useSprints(key, states?)` | → `Sprint[]` (e.g. `['planned','active']`) |
| `useCreateSprint(key)` · `useUpdateSprint(key)` · `useDeleteSprint(key)` | `{ name?, goal?, startDate?, endDate? }` · `{ id, … }` · `id` |
| `useStartSprint(key)` | `{ id, startDate, endDate, name?, goal? }` → `Sprint` |
| `useCompleteSprint(key)` | `{ id, target: 'backlog'\|'sprint'\|'new', sprintId? }` → `CompleteSprintResult` |
| `useBoard(key)` · `useBacklog(key)` · `useEpics(key)` | → `BoardResponse` · `BacklogResponse` · `EpicProgress[]` |

All SPEC §4 types plus the request and response shapes (`CreateIssueInput`, `UpdateIssueInput`,
`MoveIssueInput`, `IssueSearchParams`, `BoardResponse`, `BacklogResponse`, `RealtimeEvent`…) are in `@/api/types`.
Realtime (`useProjectRealtime`) is already mounted by `ProjectLayout`, so don't mount it again.

---

## 3. Session, roles, modals

```ts
import { useAuth, useCurrentUser } from '@/auth/AuthProvider'
const { user, logout } = useAuth()            // user: User | null
const me = useCurrentUser()                   // User (inside authenticated routes)

import { useProjectRole } from '@/lib/useProjectRole'
const { role, canEdit, isAdmin } = useProjectRole(projectKey)   // viewer → canEdit false

import { useCurrentProject } from '@/components/layout/ProjectLayout'
const project = useCurrentProject()           // only under /projects/:projectKey/*

import { useIssueModal, useCreateIssueModal, type CreateIssueDefaults } from '@/app/ModalsProvider'
const { openIssue, closeIssue, currentIssueKey } = useIssueModal()   // ?issue=GB-12
const { openCreateIssue } = useCreateIssueModal()
openCreateIssue({ projectKey: 'GB', type: 'subtask', parentId: 12, parentKey: 'GB-12', onCreated: (issue) => … })
```

- `openIssue(key)` pushes a history entry. `closeIssue()` unwinds every entry the modal pushed.
  If the page was loaded with `?issue=`, it removes the param instead.
- Modal contracts (issue agent): `IssueDetailModal({ issueKey, onClose })` and
  `CreateIssueModal({ open, defaults, onClose })`. **Each `openCreateIssue` call mounts a fresh
  `CreateIssueModal` (new React key)**, so read `defaults` in initial state. `defaults.projectKey`
  may be undefined (Create pressed outside a project). In that case, preselect the most recent
  project (`useRecentProjectKeys()`) or the first one from `useProjects()`.
- TopNav's "Create project" menu item links to **`/projects?create=1`**. The projects page should
  open its Create dialog when that param is present.

---

## 4. UI primitives — `@/components/ui` (barrel)

| Component | Props (beyond native element props) |
|---|---|
| `Button` | `variant?: 'primary'\|'secondary'\|'subtle'\|'danger'\|'link'` (default secondary), `size?: 'sm'\|'md'\|'lg'`, `loading?`, `icon?`, `iconRight?`, `fullWidth?`, `asChild?`. `type` defaults to `"button"` |
| `buttonClasses({ variant, size, fullWidth, className })` | button look for `<Link>` |
| `IconButton` | `label` (aria + tooltip), `icon`, `variant?: 'subtle'\|'secondary'\|'primary'\|'danger'`, `size?: 'xs'\|'sm'\|'md'`, `tooltip?: ReactNode\|false`, `tooltipSide?`, `loading?` |
| `Input` | `size?: 'sm'\|'md'\|'lg'`, `leadingIcon?`, `trailing?` |
| `SearchInput` | `value`, `onChange(value: string)`, `onClear?`, `placeholder?` (Esc clears) |
| `Textarea` | `autoResize? = true`, `minRows? = 3`, `maxRows? = 20` |
| `Select` (native) | `options?: { value, label, disabled? }[]`, `placeholder?`, `size?: 'sm'\|'md'` |
| `Field` | `label`, `children`, `hint?`, `error?`, `required?`, `id?`, `labelAside?`. Wires id, aria-describedby and aria-invalid into the child control automatically (`useFieldControl(props)` for custom controls) |
| `Checkbox` | `checked: boolean\|'indeterminate'`, `onCheckedChange(checked: boolean)`, `label?`, `description?`, `disabled?` |
| `Dialog` | `open`, `onOpenChange`, `title`, `description?`, `children`, `footer?`, `footerStart?`, `headerActions?`, `size?: 'sm'\|'md'\|'lg'\|'xl'` (400/560/720/1080), `hideHeader?`, `onSubmit?` (wraps in `<form>`), `preventClose?`, `onOpenAutoFocus?`, `bodyClassName?`, `data-testid?` |
| `ConfirmDialog` | `open`, `onOpenChange`, `title`, `description?`, `children?`, `confirmLabel?`, `tone?: 'danger'\|'primary'`, `loading?`, `confirmDisabled?`, `onConfirm` |
| `useConfirm()` | `await confirm({ title, description?, confirmLabel?, tone?, onConfirm?: async () => … })` → `boolean`. With `onConfirm` it shows a spinner, closes on success, and toasts the error on failure |
| `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` (`icon?`, `shortcut?`, `tone?: 'danger'`, `asChild`), `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`/`RadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuSub`/`SubTrigger`/`SubContent` | Radix menu |
| `Popover`, `PopoverTrigger`, `PopoverContent` (padded panel), `PopoverAnchor`, `PopoverClose` | Radix popover |
| `Combobox<V>` | the engine behind all pickers: `trigger`, `options: { value, label, keywords?, icon?, description?, render?, disabled?, group?, action? }[]`, `selected`, `onSelect(option)`, `multiple?`, `searchable?`, `query?`/`onQueryChange?` (server search), `loading?`, `emptyText?`, `width?: number\|'trigger'`, `header?`, `footer?` |
| `Tooltip` | `content`, `children` (single focusable element), `side?`, `align?`, `delayDuration?` |
| `Tabs`, `TabsList`, `TabsTrigger` (`count?`), `TabsContent` | underline tabs |
| `SegmentedControl<V>` | `value`, `onChange`, `options: { value, label, 'aria-label'? }[]`, `size?` |
| `Badge` | `tone?: 'neutral'\|'primary'\|'info'\|'success'\|'warning'\|'danger'`, `variant?: 'subtle'\|'solid'\|'outline'`, `shape?: 'pill'\|'square'`, `size?` |
| `ProgressBar` | `value`, `max`, `tone?`, `size?` |
| `SegmentedProgress` | `total`, `segments: { value, tone, label }[]`, for example done (success) and in progress (info) |
| `Table`, `TableHeader`, `TableBody`, `TableRow` (`interactive?`, `selected?`), `TableHead` (`sort?: 'asc'\|'desc'\|null`, `onSort?`), `TableCell` | styled table |
| `EditableText` | `value`, `onSave(v) => unknown \| Promise`, `label`, `placeholder?`, `disabled?`, `validate?`, `maxLength?`, `className?`, `data-testid?`. Enter or blur saves, Esc cancels |
| `EmptyState` | `icon?`, `title`, `description?`, `action?`, `size?: 'sm'\|'md'` |
| `ErrorState` | `error?`, `title?`, `onRetry?`, `size?` |
| `Spinner` (`size?: 'xs'\|'sm'\|'md'\|'lg'`), `CenteredSpinner`, `FullPageSpinner` | loading |
| `Skeleton` (size with classes), `SkeletonText` (`lines?`), `SkeletonRows` (`rows?`) | placeholders |
| `Kbd`, `modKeyLabel` (`⌘` / `Ctrl`) | shortcut hints |
| `toast` (sonner), `toastError(err, fallback?)` | notifications |
| `Markdown` — **import from `@/components/ui/Markdown`** (not in the barrel) | `children: string`, `className?`. GFM, no raw HTML, external links open in a new tab |

Other exports: `controlClasses` (input look), `floatingPanelClasses` (menu/popover surface), `DialogPrimitive` (raw Radix).

---

## 5. Issue-domain components — `@/components/issue` (barrel)

Display:
- `IssueTypeIcon({ type, size?: 'sm'|'md'|'lg', title? })`: white glyph on the type colour.
- `PriorityIcon({ priority, size?: 'sm'|'md', showLabel? })`
- `StatusLozenge({ status: { name, category } })`: uppercase, 11px, grey, blue or green.
- `LabelChip({ label, onRemove?, size? })` · `LabelList({ labels, max = 2 })`: shows `+n` beyond `max`.
- `UserAvatar({ user: {id,name} | null, size?: 'xs'|'sm'|'md'|'lg'|'xl', showName?, tooltip?, emptyLabel? = 'Unassigned' })`
- `ProjectAvatar({ project: { key, name? }, size?: 'sm'|'md'|'lg'|'xl' })`
- `IssueKeyLink({ issueKey, tone?: 'link'|'muted', done?, children? })`: opens the modal. Modifier-click opens `/browse/KEY`.
- `EpicChip({ epic: { id, summary, key? }, interactive? })`: deterministic epic colour.
- `StoryPointsBadge({ points, showEmpty? })` · `DueDateLabel({ date, resolved?, format?: 'short'|'long', showIcon?, emptyText? })`
- `ActivityItem({ activity, withIssue?, showProject?, hideAvatar? })`: avatar, "**Alex** changed Status from To Do to In Progress", relative time, and a comment excerpt when relevant.

Pickers: all share `PickerCommonProps`:
`variant?: 'field' | 'inline' | 'compact'` (bordered form control, borderless hover-to-edit value
for the issue side panel, or icon/avatar-only for rows and cards), `disabled?` (read-only display), `placeholder?`,
`className?`, `id?`, `aria-label?`, `data-testid?`, `trigger?: ReactElement` (custom trigger. It must
forward ref and props, as all ui buttons do), `align?`, `open?`/`onOpenChange?`.
Inside a `Field` they are labelled automatically. They call `onChange` only when the value actually changes.

| Picker | value → onChange |
|---|---|
| `TypeSelect` | `value: IssueType` → `onChange(type)`. `types?` restricts the options (use `allowedTypeChanges(issue.type)` when editing) |
| `StatusSelect` | `projectKey`, `value: ID \| Status \| null` → `onChange(statusId, status)`. `variant` also accepts **`'button'`** (the prominent coloured status button). `statuses?` avoids a fetch |
| `PrioritySelect` | `value: Priority` → `onChange(priority)` |
| `UserPicker` | `projectKey`, `value: ID \| UserSummary \| null` → `onChange(userId \| null, user \| null)`. Options: `allowUnassigned? = true`, `unassignedLabel?`, `avatarSize?` |
| `LabelMultiSelect` | `projectKey`, `value: ID[] \| Label[]` → `onChange(labelIds, labels)`. Options: `allowCreate? = true` (inline "Create “x”"), `commitMode?: 'immediate' \| 'onClose'`. Use **`onClose`** for inline editing, so one PATCH fires when the popover closes |
| `SprintSelect` | `projectKey`, `value: ID \| {id,name,state} \| null` (null = Backlog) → `onChange(sprintId \| null, sprint \| null)`. Options: `allowBacklog?`, `backlogLabel?` |
| `ParentPicker` | `projectKey`, `childType`, `value: {id,key,summary,type} \| null` → `onChange(issue \| null)`. Epics for story, task and bug. Stories, tasks and bugs for subtasks (required, so no "None"). Disabled for epics |
| `IssuePicker` | `value: {id,key,summary,type} \| null` → `onChange(issue \| null)`. Options: `projectKey?`, `types?`, `excludeIds?`, `allowNone?`, `noneLabel?`, `searchPlaceholder?` (server search on key or text, for links) |
| `ProjectSelect` | `value: projectKey \| null` → `onChange(key, project)`. `filter?: (p) => boolean` (for example `p.myRole !== 'viewer'`) |

`PickerTrigger`/`PickerPlaceholder` are exported for building extra pickers on `Combobox`.

```tsx
// issue side panel (inline editing, read-only for viewers)
<UserPicker variant="inline" projectKey={issue.projectKey} value={issue.assignee}
  disabled={!canEdit} onChange={(assigneeId) => update.mutate({ assigneeId })} />
<StatusSelect variant="button" data-testid="issue-status" projectKey={issue.projectKey}
  value={issue.status} onChange={(statusId) => update.mutate({ statusId })} />
<LabelMultiSelect variant="inline" commitMode="onClose" projectKey={issue.projectKey}
  value={issue.labels} onChange={(labelIds) => update.mutate({ labelIds })} />
// form
<Field label="Assignee"><UserPicker projectKey={key} value={assigneeId} onChange={setAssigneeId} /></Field>
// card: avatar-only
<UserPicker variant="compact" projectKey={key} value={issue.assignee} onChange={…} />
```

---

## 6. Layout — `@/components/layout`

- `PageContainer({ size?: 'full'|'wide'|'narrow', className?, children })`: standard padding.
- `PageHeader({ title, breadcrumbs?: { label, to? }[], description?, actions?, children? (toolbar row) })`
- `useCurrentProject()` (from `ProjectLayout`). `AppLayout`, `TopNav`, `ProjectLayout` and `ProjectSidebar` are already wired into the router.

---

## 7. Helpers — `@/lib/*`

- `cn(...classes)`: clsx + tailwind-merge, aware of the custom `text-2xs` and `shadow-*`.
- `dates`: `formatDate` (Sep 24, 2026) · `formatShortDate` · `formatDateTime` · `formatRelative`
  (just now / 5 minutes ago / yesterday) · `formatTime` · `daysRemaining(end)` (0 = today, negative = overdue) ·
  `formatDaysRemaining(end)` · `formatDateRange(s, e)` · `formatDayHeading(ts)` (Today / Yesterday /
  Monday, Sep 21) · `dayKey(ts)` · `toISODate(date)` · `todayISO()` · `addWeeksISO(d, n)` · `addDaysISO` ·
  `isOverdue(d)` · `toDate(v)`. `YYYY-MM-DD` strings are parsed as local dates.
- `issueMeta`: `ISSUE_TYPE_META[type] {label,color,icon,description}`, `ISSUE_TYPES`,
  `STANDARD_ISSUE_TYPES`, `isStandardType`, `allowedParentTypes(child)`, `allowedChildTypes(parent)`,
  `allowedTypeChanges(type)`, `PRIORITY_META[p] {label,color,icon,order}`, `PRIORITIES`,
  `comparePriority`, `STATUS_CATEGORY_META[c] {label, lozengeClassName, dotClassName, textClassName}`,
  `STATUS_CATEGORIES`, `LINK_TYPE_META[t] {outward,inward}`, `LINK_TYPES`, `SPRINT_STATE_META`,
  `ROLE_META`, `ROLES`, `PROJECT_TYPE_META`, `compareRank` / `sortByRank` (byte-wise like the server),
  `issueNumber(key)`, `isDone(issue)`, `formatPoints(n)`.
- `colors`: `avatarColor(userId)`, `epicColor(epicId)`, `colorForString(s)`, `initials(name)`,
  `chipStyle(hex)` (use with the `chip-tint` class), `LABEL_COLORS` (swatches), `DEFAULT_LABEL_COLOR`, `isHexColor`.
- `activity`: `describeActivity(a, { withIssue? })` returns the sentence without the actor ("changed Status
  of GB-12 from To Do to In Progress", "created the issue", "added a comment", "started sprint GB
  Sprint 2"…). `activitySentence(a)` includes the actor. `ACTIVITY_FIELD_LABELS`.
- `projectKey`: `projectKeyOf('GB-12') === 'GB'`, `normalizeKey`, `isIssueKey`,
  `suggestProjectKey(name)` ("Gene Board" gives "GB"), `validateProjectKey(key)` (returns an error message or null).
- `errors`: `errorMessage(err, fallback?)`, `fieldErrors(err)` (server `fields`), `isApiStatus(err, 404)`.
- `format`: `pluralize(n, 'issue')`, `truncate(s, n)`, `issueUrl(key)` (absolute, for copy link), `percent(a, b)`.
- `hooks`: `useDebouncedValue(v, ms?)`, `useLocalStorageState(key, init)`, `useHotkey(key, fn,
  { mod?, shift?, allowInInputs?, enabled? })`, `useDocumentTitle(title)`, `copyToClipboard(text)`, `isTypingTarget`.
- `useProjectRole(key) → { role, canEdit, isAdmin, isLoading }` · `useCurrentProjectKey()` ·
  `recentProjects`: `useRecentProjectKeys()`, `recordRecentProject(key)` (ProjectLayout records visits).

---

## 8. Design tokens (Tailwind class names)

`bg-bg` (app background, sidebar) · `bg-surface` (cards, panels, modals, inputs, page content) ·
`bg-surface-sunken` (board columns, backlog sections, code) · `bg-surface-hover` ·
`bg-surface-selected` · `bg-surface-raised` (menus, popovers) · `bg-overlay` (scrim) ·
`border-border` / `border-border-strong` · `text-fg` / `text-fg-muted` / `text-fg-subtle` ·
`primary` / `primary-hover` / `primary-fg` / `primary-subtle` · `danger` (+`-hover`, `-fg`,
`-subtle`) · `success`/`success-subtle` · `warning`/`warning-subtle` · `info`/`info-subtle`
(blue, in-progress) · `neutral`/`neutral-subtle` (grey, to-do) · `ring`. All of them work with any colour
utility (`bg-`, `text-`, `border-`, `ring-`, `fill-`, `outline-`) and with opacity (`bg-primary/10`).
Shadows: `shadow-card` (board cards), `shadow-raised` (dragging), `shadow-overlay` (floating).
Utilities: `chip-tint` + `style={chipStyle(hex)}` (tinted chip readable in both themes),
`scrollbar-thin`, `.markdown` (rendered Markdown typography), `animate-fade-in`, `animate-scale-in`,
`animate-slide-down`, `animate-shimmer`. Dark mode is `.dark` on `<html>`, and the tokens switch
automatically. Use the `dark:` variant only for rare exceptions.
