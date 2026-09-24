import type { BacklogResponse, ID, Issue, IssueRef, Sprint, StatusCategory } from '@/api/types'
import { sortByRank } from '@/lib/issueMeta'

// ---------------------------------------------------------------------------------------------
// Containers (sections)
// ---------------------------------------------------------------------------------------------

/** Section id: `sprint-<id>`, `backlog`, or `all` (Kanban's single flat list). */
export type ContainerId = string

/** The Backlog section (issues without a sprint). */
export const BACKLOG_CONTAINER: ContainerId = 'backlog'
/** Kanban: one flat ranked list of every issue (no sprints). */
export const FLAT_CONTAINER: ContainerId = 'all'

/** Container id of a sprint section. */
export function sprintContainerId(sprintId: ID): ContainerId {
  return `sprint-${sprintId}`
}

/**
 * - `sprint`: an active/planned sprint; moving in sets `sprintId`
 * - `backlog`: no sprint; moving in sets `sprintId: null`
 * - `flat`: Kanban list; moves only re-rank (sprint untouched)
 */
export type ContainerKind = 'sprint' | 'backlog' | 'flat'

/** One stacked backlog section with its full (unfiltered) issue list in rank order. */
export interface BacklogContainer {
  id: ContainerId
  kind: ContainerKind
  sprint: Sprint | null
  issues: Issue[]
}

/**
 * Sections from GET /backlog: sprints (active first, then planned — server order) followed by
 * the Backlog. With `flat` (Kanban) everything is merged into one rank-ordered list.
 */
export function buildContainers(data: BacklogResponse, flat: boolean): BacklogContainer[] {
  if (flat) {
    const issues = sortByRank([...data.sprints.flatMap((s) => s.issues), ...data.backlog])
    return [{ id: FLAT_CONTAINER, kind: 'flat', sprint: null, issues }]
  }
  return [
    ...data.sprints.map(
      (s): BacklogContainer => ({ id: sprintContainerId(s.sprint.id), kind: 'sprint', sprint: s.sprint, issues: s.issues }),
    ),
    { id: BACKLOG_CONTAINER, kind: 'backlog', sprint: null, issues: data.backlog },
  ]
}

/** Display name of a section ("GB Sprint 3", "Backlog"). */
export function containerName(container: Pick<BacklogContainer, 'kind' | 'sprint'>): string {
  if (container.kind === 'sprint' && container.sprint) return container.sprint.name
  return 'Backlog'
}

/**
 * The `sprintId` to send when an issue moves *into* this container from another one:
 * a sprint id, `null` for the backlog, `undefined` for Kanban (never touch the sprint).
 */
export function containerSprintId(container: Pick<BacklogContainer, 'kind' | 'sprint'>): ID | null | undefined {
  if (container.kind === 'sprint') return container.sprint?.id ?? null
  if (container.kind === 'backlog') return null
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

/** Epic filter: all issues, issues without an epic, or the children of one epic. */
export type EpicFilter = null | 'none' | ID

/** Assignee quick-filter entry: a user id or `none` (unassigned). */
export type AssigneeFilterValue = ID | 'none'

/** Client-side backlog filters. */
export interface BacklogFilters {
  query: string
  assignees: readonly AssigneeFilterValue[]
  epic: EpicFilter
}

/** Filters with nothing selected. */
export const EMPTY_FILTERS: BacklogFilters = { query: '', assignees: [], epic: null }

/** True when any filter narrows the list. */
export function hasActiveFilters(filters: BacklogFilters): boolean {
  return filters.query.trim() !== '' || filters.assignees.length > 0 || filters.epic !== null
}

/** The epic an issue belongs to (standard issues' parent is always an epic when set). */
export function epicOf(issue: Issue): IssueRef | null {
  return issue.parent?.type === 'epic' ? issue.parent : null
}

/** Whether an issue passes all filters (text matches key or summary, case-insensitive). */
export function matchesFilters(issue: Issue, filters: BacklogFilters): boolean {
  const q = filters.query.trim().toLowerCase()
  if (q && !issue.key.toLowerCase().includes(q) && !issue.summary.toLowerCase().includes(q)) return false
  if (filters.assignees.length > 0) {
    const value: AssigneeFilterValue = issue.assignee?.id ?? 'none'
    if (!filters.assignees.includes(value)) return false
  }
  if (filters.epic !== null) {
    const epic = epicOf(issue)
    if (filters.epic === 'none' ? epic !== null : epic?.id !== filters.epic) return false
  }
  return true
}

// ---------------------------------------------------------------------------------------------
// Roll-ups
// ---------------------------------------------------------------------------------------------

/** Story points per status category (null estimates count as 0). */
export type PointsByCategory = Record<StatusCategory, number>

/** Sum story points of `issues` by status category. */
export function pointsByCategory(issues: readonly Issue[]): PointsByCategory {
  const totals: PointsByCategory = { todo: 0, in_progress: 0, done: 0 }
  for (const issue of issues) totals[issue.status.category] += issue.storyPoints ?? 0
  return totals
}

// ---------------------------------------------------------------------------------------------
// Moves (drag & drop) — optimistic overlay and neighbour resolution
// ---------------------------------------------------------------------------------------------

/**
 * A move that was dropped but not yet confirmed by the server. Pending moves are replayed on
 * top of the server lists until the mutation settles, so the UI never snaps back while
 * refetches race. Replaying a move the server already applied is a no-op.
 */
export interface PendingMove {
  token: number
  issueId: ID
  to: ContainerId
  /** Issue directly above in the destination's full list (null = top). */
  prevId: ID | null
  /** Issue directly below in the destination's full list (null = bottom). */
  nextId: ID | null
}

function insertionIndex(list: readonly Issue[], prevId: ID | null, nextId: ID | null): number {
  if (prevId != null) {
    const i = list.findIndex((x) => x.id === prevId)
    if (i >= 0) return i + 1
  }
  if (nextId != null) {
    const i = list.findIndex((x) => x.id === nextId)
    if (i >= 0) return i
  }
  // Neighbour vanished (deleted meanwhile): keep the intent — top if it was dropped first.
  return prevId == null && nextId != null ? 0 : list.length
}

function withSprint(issue: Issue, container: BacklogContainer): Issue {
  if (container.kind === 'flat') return issue
  const sprint = container.kind === 'sprint' && container.sprint ? container.sprint : null
  if ((issue.sprint?.id ?? null) === (sprint?.id ?? null)) return issue
  return { ...issue, sprint: sprint ? { id: sprint.id, name: sprint.name, state: sprint.state } : null }
}

/** Replays pending moves (in order) on top of the server containers. Pure. */
export function applyPendingMoves(
  containers: readonly BacklogContainer[],
  moves: readonly PendingMove[],
): BacklogContainer[] {
  if (moves.length === 0) return containers as BacklogContainer[]
  const result = containers.map((c) => ({ ...c, issues: [...c.issues] }))
  for (const move of moves) {
    const target = result.find((c) => c.id === move.to)
    if (!target) continue
    let moved: Issue | undefined
    for (const c of result) {
      const i = c.issues.findIndex((x) => x.id === move.issueId)
      if (i >= 0) {
        moved = c.issues[i]
        c.issues.splice(i, 1)
        break
      }
    }
    if (!moved) continue
    target.issues.splice(insertionIndex(target.issues, move.prevId, move.nextId), 0, withSprint(moved, target))
  }
  return result
}

/** Neighbour ids sent to POST /issues/{key}/move. */
export interface Neighbours {
  prevId: ID | null
  nextId: ID | null
}

/**
 * Resolve the drop position inside the *full* destination list (`full` excludes the moved
 * issue) from the *visible* neighbours the user dropped between. With filters active hidden
 * issues sit between visible ones; the moved issue is placed directly after the visible issue
 * above it (or directly before the visible issue below it when dropped first), and the hidden
 * issue on the other side becomes the second neighbour. An empty visible list appends.
 */
export function resolveNeighbours(full: readonly Issue[], visibleAboveId: ID | null, visibleBelowId: ID | null): Neighbours {
  if (visibleAboveId != null) {
    const i = full.findIndex((x) => x.id === visibleAboveId)
    if (i >= 0) return { prevId: visibleAboveId, nextId: full[i + 1]?.id ?? null }
  }
  if (visibleBelowId != null) {
    const i = full.findIndex((x) => x.id === visibleBelowId)
    if (i >= 0) return { prevId: full[i - 1]?.id ?? null, nextId: visibleBelowId }
  }
  return { prevId: full[full.length - 1]?.id ?? null, nextId: null }
}

/** Current neighbours of an issue inside a full list (for no-op detection). */
export function currentNeighbours(full: readonly Issue[], issueId: ID): Neighbours | null {
  const i = full.findIndex((x) => x.id === issueId)
  if (i < 0) return null
  return { prevId: full[i - 1]?.id ?? null, nextId: full[i + 1]?.id ?? null }
}
