import type {
  ID,
  Issue,
  IssueSearchParams,
  IssueSort,
  IssueType,
  Priority,
  SortOrder,
  Status,
  StatusCategory,
} from '@/api/types'
import { ISSUE_TYPES, PRIORITIES, PRIORITY_META, STATUS_CATEGORIES, STATUS_CATEGORY_META } from '@/lib/issueMeta'

/**
 * Issue search filters and their URL representation.
 *
 * Every filter lives in the page URL so searches are shareable and the back button restores
 * them. URL parameters (lists are comma-separated):
 *
 * | param      | meaning                                              | route   |
 * |------------|------------------------------------------------------|---------|
 * | `q`        | text (key match or summary/description contains)     | both    |
 * | `project`  | project key                                          | global  |
 * | `type`     | issue types                                          | both    |
 * | `category` | status categories (`todo,in_progress,done`)          | both    |
 * | `status`   | status ids of the project                            | project |
 * | `priority` | priorities                                           | both    |
 * | `assignee` | `me`, `none` and (project) member ids                | both    |
 * | `reporter` | `me` and (project) member ids                        | both    |
 * | `label`    | label ids                                            | project |
 * | `epic`     | epic id (its child issues)                           | project |
 * | `sprint`   | `active`, `none` (backlog) or (project) a sprint id   | both    |
 * | `resolved` | `true` / `false`                                     | both    |
 * | `sort`     | column (see {@link SortColumn}); `order` = asc/desc  | both    |
 * | `page`     | 1-based page number                                  | both    |
 *
 * "project" filters need one project: the scoped route's, or on the global route the one
 * picked in the project filter. Without it they are ignored. Unknown or malformed values are
 * dropped while parsing, so a hand-edited URL never turns into a 400 from the API.
 */

/** Issues per page of the search table. */
export const PAGE_SIZE = 50

/** An assignee filter entry: the caller, unassigned, or a user id. */
export type AssigneeFilter = 'me' | 'none' | ID

/** A reporter filter entry: the caller or a user id. */
export type ReporterFilter = 'me' | ID

/** Sprint filter: the active sprint, the backlog (no sprint) or a specific sprint. */
export type SprintFilter = 'active' | 'none' | ID

/** Sortable table columns. */
export type SortColumn = 'key' | 'summary' | 'type' | 'status' | 'priority' | 'assignee' | 'created' | 'updated' | 'due'

/** Parsed, validated filter state of the issues page. */
export interface IssueFilters {
  q: string
  /** Project key (global route only; the scoped route always searches its own project). */
  project: string | null
  types: IssueType[]
  categories: StatusCategory[]
  statusIds: ID[]
  priorities: Priority[]
  assignees: AssigneeFilter[]
  reporters: ReporterFilter[]
  labelIds: ID[]
  /** Epic whose child issues to list. */
  epic: ID | null
  sprint: SprintFilter | null
  resolved: boolean | null
  sort: SortColumn
  order: SortOrder
  page: number
}

/** Filters that narrow the result set (everything except sort and page). */
export type FilterField = Exclude<keyof IssueFilters, 'sort' | 'order' | 'page'>

/** How each column sorts: server-side (`GET /issues?sort=`) or client-side over all matches. */
export const SORT_COLUMNS: Record<SortColumn, { label: string; server: IssueSort | null; defaultOrder: SortOrder }> = {
  key: { label: 'Key', server: 'key', defaultOrder: 'asc' },
  summary: { label: 'Summary', server: 'summary', defaultOrder: 'asc' },
  type: { label: 'Type', server: null, defaultOrder: 'asc' },
  status: { label: 'Status', server: null, defaultOrder: 'asc' },
  priority: { label: 'Priority', server: 'priority', defaultOrder: 'asc' },
  assignee: { label: 'Assignee', server: null, defaultOrder: 'asc' },
  created: { label: 'Created', server: 'created', defaultOrder: 'desc' },
  updated: { label: 'Updated', server: 'updated', defaultOrder: 'desc' },
  due: { label: 'Due', server: 'dueDate', defaultOrder: 'asc' },
}

/** Default ordering of the issues page: most recently updated first. */
export const DEFAULT_SORT: { sort: SortColumn; order: SortOrder } = { sort: 'updated', order: 'desc' }

/** The empty filter state. */
export const EMPTY_FILTERS: IssueFilters = {
  q: '',
  project: null,
  types: [],
  categories: [],
  statusIds: [],
  priorities: [],
  assignees: [],
  reporters: [],
  labelIds: [],
  epic: null,
  sprint: null,
  resolved: null,
  ...DEFAULT_SORT,
  page: 1,
}

/** URL parameter names owned by the filter state (everything else, e.g. `issue`, is preserved). */
export const FILTER_PARAM_NAMES = [
  'q',
  'project',
  'type',
  'category',
  'status',
  'priority',
  'assignee',
  'reporter',
  'label',
  'epic',
  'sprint',
  'resolved',
  'sort',
  'order',
  'page',
] as const

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

function list(params: URLSearchParams, name: string): string[] {
  const raw = params.get(name)
  if (!raw) return []
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function oneOf<T extends string>(allowed: readonly T[], values: string[]): T[] {
  return unique(values.map((v) => v.toLowerCase()).filter((v): v is T => (allowed as readonly string[]).includes(v)))
}

function positiveId(value: string): ID | null {
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function ids(values: string[]): ID[] {
  return unique(values.map(positiveId).filter((n): n is ID => n != null))
}

function isSortColumn(value: string | null): value is SortColumn {
  return value != null && value in SORT_COLUMNS
}

/**
 * Parse the filter state from URL search params. `scoped` = the project issues route. The
 * project-specific filters (status ids, member ids, labels, epics, sprint ids) are kept when
 * the search is limited to one project — the scoped route's, or the global route's project
 * filter — and ignored otherwise.
 */
export function parseFilters(params: URLSearchParams, scoped: boolean): IssueFilters {
  const projectRaw = params.get('project')?.trim().toUpperCase() ?? ''
  const project = !scoped && /^[A-Z][A-Z0-9]{1,9}$/.test(projectRaw) ? projectRaw : null
  const oneProject = scoped || project != null

  const people = <T extends string>(name: string, keywords: readonly T[]): (T | ID)[] =>
    unique(
      list(params, name)
        .map((v): T | ID | null => {
          const lower = v.toLowerCase()
          if ((keywords as readonly string[]).includes(lower)) return lower as T
          return oneProject ? positiveId(v) : null
        })
        .filter((v): v is T | ID => v != null),
    )

  const sprintRaw = params.get('sprint')?.trim().toLowerCase() ?? ''
  const sprint: SprintFilter | null =
    sprintRaw === 'active' || sprintRaw === 'none' ? sprintRaw : oneProject ? positiveId(sprintRaw) : null

  const resolvedRaw = params.get('resolved')?.trim().toLowerCase()
  const sortRaw = params.get('sort')?.trim() ?? null
  const sort = isSortColumn(sortRaw) ? sortRaw : DEFAULT_SORT.sort
  const orderRaw = params.get('order')?.trim().toLowerCase()
  const order: SortOrder = orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : SORT_COLUMNS[sort].defaultOrder
  const pageRaw = positiveId(params.get('page')?.trim() ?? '')

  return {
    q: params.get('q')?.trim() ?? '',
    project,
    types: oneOf(ISSUE_TYPES, list(params, 'type')),
    categories: oneOf(STATUS_CATEGORIES, list(params, 'category')),
    statusIds: oneProject ? ids(list(params, 'status')) : [],
    priorities: oneOf(PRIORITIES, list(params, 'priority')),
    assignees: people(`assignee`, ['me', 'none'] as const),
    reporters: people('reporter', ['me'] as const),
    labelIds: oneProject ? ids(list(params, 'label')) : [],
    epic: oneProject ? positiveId(params.get('epic')?.trim() ?? '') : null,
    sprint,
    resolved: resolvedRaw === 'true' ? true : resolvedRaw === 'false' ? false : null,
    sort,
    order,
    page: pageRaw ?? 1,
  }
}

/**
 * The filter values that only make sense inside one project, cleared: applied when the
 * global route's project filter changes (ids of another project would match nothing).
 */
export function withoutProjectScopedFilters(filters: IssueFilters): Partial<IssueFilters> {
  return {
    statusIds: [],
    assignees: filters.assignees.filter((a) => typeof a !== 'number'),
    reporters: filters.reporters.filter((r) => typeof r !== 'number'),
    labelIds: [],
    epic: null,
    sprint: typeof filters.sprint === 'number' ? null : filters.sprint,
  }
}

// ---------------------------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------------------------

/**
 * Write the filter state into `base` (a copy of the current search params): unrelated params
 * such as `issue` (the issue modal) are kept; defaults are omitted so URLs stay short.
 */
export function writeFilters(base: URLSearchParams, filters: IssueFilters): URLSearchParams {
  const next = new URLSearchParams(base)
  for (const name of FILTER_PARAM_NAMES) next.delete(name)
  const set = (name: string, value: string | null | undefined) => {
    if (value) next.set(name, value)
  }
  set('q', filters.q.trim())
  set('project', filters.project)
  set('type', filters.types.join(','))
  set('category', filters.categories.join(','))
  set('status', filters.statusIds.join(','))
  set('priority', filters.priorities.join(','))
  set('assignee', filters.assignees.join(','))
  set('reporter', filters.reporters.join(','))
  set('label', filters.labelIds.join(','))
  set('epic', filters.epic == null ? null : String(filters.epic))
  set('sprint', filters.sprint == null ? null : String(filters.sprint))
  set('resolved', filters.resolved == null ? null : String(filters.resolved))
  const isDefaultSort = filters.sort === DEFAULT_SORT.sort && filters.order === DEFAULT_SORT.order
  if (!isDefaultSort) {
    set('sort', filters.sort)
    if (filters.order !== SORT_COLUMNS[filters.sort].defaultOrder) set('order', filters.order)
  }
  if (filters.page > 1) set('page', String(filters.page))
  return next
}

/**
 * Link to the issue search with some filters applied, e.g.
 * `issueSearchPath({ assignees: ['me'], categories: ['todo', 'in_progress'] })` →
 * `/issues?category=todo,in_progress&assignee=me`. Pass `projectKey` for the scoped route.
 */
export function issueSearchPath(filters: Partial<IssueFilters>, projectKey?: string): string {
  const params = writeFilters(new URLSearchParams(), { ...EMPTY_FILTERS, ...filters })
  const qs = params.toString().replace(/%2C/g, ',')
  const base = projectKey ? `/projects/${projectKey.toUpperCase()}/issues` : '/issues'
  return qs ? `${base}?${qs}` : base
}

/** Number of active narrowing filters (for the "Clear filters" affordance). */
export function activeFilterCount(filters: IssueFilters): number {
  return (
    (filters.q ? 1 : 0) +
    (filters.project ? 1 : 0) +
    (filters.types.length > 0 ? 1 : 0) +
    (filters.categories.length + filters.statusIds.length > 0 ? 1 : 0) +
    (filters.priorities.length > 0 ? 1 : 0) +
    (filters.assignees.length > 0 ? 1 : 0) +
    (filters.reporters.length > 0 ? 1 : 0) +
    (filters.labelIds.length > 0 ? 1 : 0) +
    (filters.epic != null ? 1 : 0) +
    (filters.sprint != null ? 1 : 0) +
    (filters.resolved != null ? 1 : 0)
  )
}

// ---------------------------------------------------------------------------------------------
// API parameters
// ---------------------------------------------------------------------------------------------

/**
 * True when the status filter mixes categories and specific statuses. They share one menu, so
 * the user means "any of these" (OR), while the API ANDs `statusCategory` with `statusId`:
 * {@link toSearchParams} then needs the project's statuses to expand the categories.
 */
export function mixesStatusFilters(filters: IssueFilters): boolean {
  return filters.categories.length > 0 && filters.statusIds.length > 0
}

/**
 * `GET /issues` parameters for the filters (without sort/paging). `projectKey` is the scoped
 * route's project; on the global route the `project` filter is used instead. `statuses` (the
 * project's statuses) turns a mixed category + status selection into one `statusId` list.
 */
export function toSearchParams(
  filters: IssueFilters,
  projectKey: string | null,
  statuses?: readonly Pick<Status, 'id' | 'category'>[],
): IssueSearchParams {
  let statusCategory: StatusCategory[] = filters.categories
  let statusId: ID[] = filters.statusIds
  if (mixesStatusFilters(filters) && statuses) {
    const fromCategories = statuses.filter((s) => filters.categories.includes(s.category)).map((s) => s.id)
    statusId = Array.from(new Set([...filters.statusIds, ...fromCategories]))
    statusCategory = []
  }
  return {
    project: projectKey ?? filters.project ?? undefined,
    q: filters.q || undefined,
    type: filters.types,
    statusCategory,
    statusId,
    priority: filters.priorities,
    assigneeId: filters.assignees,
    reporterId: filters.reporters,
    labelId: filters.labelIds,
    epicId: filters.epic ?? undefined,
    sprintId: filters.sprint ?? undefined,
    resolved: filters.resolved ?? undefined,
  }
}

// ---------------------------------------------------------------------------------------------
// Client-side sorting (columns the API cannot sort by)
// ---------------------------------------------------------------------------------------------

function compareKeys(a: string, b: string): number {
  const [pa, na] = splitKey(a)
  const [pb, nb] = splitKey(b)
  return pa === pb ? na - nb : pa < pb ? -1 : 1
}

function splitKey(key: string): [string, number] {
  const dash = key.lastIndexOf('-')
  return [key.slice(0, dash), Number(key.slice(dash + 1)) || 0]
}

const TYPE_ORDER: Record<IssueType, number> = Object.fromEntries(ISSUE_TYPES.map((t, i) => [t, i])) as Record<
  IssueType,
  number
>

/**
 * Comparator for the client-sorted columns (type, status, assignee). Ties fall back to the
 * issue key so the order is stable across pages. Unassigned issues sort after assigned ones
 * in ascending order.
 */
export function clientComparator(column: SortColumn, order: SortOrder): (a: Issue, b: Issue) => number {
  const dir = order === 'asc' ? 1 : -1
  const primary = (a: Issue, b: Issue): number => {
    switch (column) {
      case 'type':
        return TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
      case 'status':
        return (
          STATUS_CATEGORY_META[a.status.category].order - STATUS_CATEGORY_META[b.status.category].order ||
          a.status.position - b.status.position ||
          a.status.name.localeCompare(b.status.name)
        )
      case 'assignee':
        if (!a.assignee || !b.assignee) return a.assignee ? -1 : b.assignee ? 1 : 0
        return a.assignee.name.localeCompare(b.assignee.name)
      case 'priority':
        return PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order
      case 'summary':
        return a.summary.localeCompare(b.summary)
      case 'created':
        return Date.parse(a.createdAt) - Date.parse(b.createdAt)
      case 'updated':
        // Compare instants, not strings: the API omits the fractional part of whole-second
        // timestamps ("…:00Z" vs "…:00.123Z"), so lexical order isn't chronological.
        return Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
      case 'due':
        if (!a.dueDate || !b.dueDate) return a.dueDate ? -1 : b.dueDate ? 1 : 0
        return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0
      case 'key':
        return 0
    }
  }
  return (a, b) => dir * (primary(a, b) || compareKeys(a.key, b.key))
}
