import { useCallback, useMemo, useState } from 'react'
import type { ID, Issue, IssueType, UserSummary } from '@/api/types'

/** `'none'` stands for "Unassigned" / "Issues without epic". */
export type AssigneeFilterValue = ID | 'none'
/** An epic id, or `'none'` for issues without an epic. */
export type EpicFilterValue = ID | 'none'

/** Client-side quick filters of the board toolbar. Different filters combine with AND. */
export interface BoardFilters {
  /** Matches the issue key or summary (case-insensitive). */
  text: string
  /** Any of these assignees (OR); empty = everyone. */
  assignees: readonly AssigneeFilterValue[]
  /** Only issues assigned to the current user. */
  onlyMine: boolean
  /** Any of these types (OR); empty = all types. */
  types: readonly IssueType[]
  /** Issues under any of these epics (OR); subtasks inherit their parent's epic. */
  epics: readonly EpicFilterValue[]
  hideSubtasks: boolean
}

/** No filter applied. */
export const EMPTY_FILTERS: BoardFilters = {
  text: '',
  assignees: [],
  onlyMine: false,
  types: [],
  epics: [],
  hideSubtasks: false,
}

/** Issue types that can appear on a board (epics never do). */
export const BOARD_ISSUE_TYPES: readonly IssueType[] = ['story', 'task', 'bug', 'subtask']

/** True when any filter narrows the board. */
export function hasActiveFilters(filters: BoardFilters): boolean {
  return (
    filters.text.trim() !== '' ||
    filters.assignees.length > 0 ||
    filters.onlyMine ||
    filters.types.length > 0 ||
    filters.epics.length > 0 ||
    filters.hideSubtasks
  )
}

/** Compact epic reference used by the epic filter. */
export interface EpicOption {
  id: ID
  key: string
  summary: string
}

/**
 * The epic an issue belongs to: its parent when that is an epic; for a subtask, the epic of its
 * parent issue, looked up in `byId` (the board's issues plus `BoardResponse.parents`, the parents
 * a Kanban board leaves out).
 */
export function epicOf(issue: Issue, byId: ReadonlyMap<ID, Issue>): EpicOption | null {
  const parent = issue.parent
  if (!parent) return null
  if (parent.type === 'epic') return { id: parent.id, key: parent.key, summary: parent.summary }
  if (issue.type === 'subtask') {
    const grand = byId.get(parent.id)?.parent
    if (grand?.type === 'epic') return { id: grand.id, key: grand.key, summary: grand.summary }
  }
  return null
}

/** Build the predicate for a set of filters. */
export function createIssueMatcher(
  filters: BoardFilters,
  { meId, byId }: { meId: ID; byId: ReadonlyMap<ID, Issue> },
): (issue: Issue) => boolean {
  const text = filters.text.trim().toLowerCase()
  const assignees = new Set(filters.assignees)
  const types = new Set(filters.types)
  const epics = new Set(filters.epics)
  return (issue) => {
    if (filters.hideSubtasks && issue.type === 'subtask') return false
    if (types.size > 0 && !types.has(issue.type)) return false
    if (filters.onlyMine && issue.assignee?.id !== meId) return false
    if (assignees.size > 0 && !assignees.has(issue.assignee?.id ?? 'none')) return false
    if (epics.size > 0 && !epics.has(epicOf(issue, byId)?.id ?? 'none')) return false
    if (text && !issue.summary.toLowerCase().includes(text) && !issue.key.toLowerCase().includes(text)) return false
    return true
  }
}

/** Choices offered by the toolbar, derived from the issues on the board. */
export interface BoardFilterOptions {
  /** Distinct assignees on the board, by name. */
  assignees: UserSummary[]
  hasUnassigned: boolean
  /** Distinct epics of the board's issues, by key number. */
  epics: EpicOption[]
  hasIssuesWithoutEpic: boolean
  hasSubtasks: boolean
}

/** Derive the toolbar options from the board's issues. */
export function deriveFilterOptions(issues: readonly Issue[], byId: ReadonlyMap<ID, Issue>): BoardFilterOptions {
  const assignees = new Map<ID, UserSummary>()
  const epics = new Map<ID, EpicOption>()
  let hasUnassigned = false
  let hasIssuesWithoutEpic = false
  let hasSubtasks = false
  for (const issue of issues) {
    if (issue.assignee) assignees.set(issue.assignee.id, issue.assignee)
    else hasUnassigned = true
    const epic = epicOf(issue, byId)
    if (epic) epics.set(epic.id, epic)
    else hasIssuesWithoutEpic = true
    if (issue.type === 'subtask') hasSubtasks = true
  }
  return {
    assignees: [...assignees.values()].sort((a, b) => a.name.localeCompare(b.name)),
    hasUnassigned,
    epics: [...epics.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    hasIssuesWithoutEpic,
    hasSubtasks,
  }
}

/**
 * The filters without the epic and assignee values the toolbar no longer offers (the epic was
 * deleted, the person removed, or their last issue left the board): those would narrow the
 * board with no visible control to turn them off. Returns `filters` itself when nothing is dropped.
 */
export function pruneFilters(filters: BoardFilters, options: BoardFilterOptions): BoardFilters {
  const epics = new Set<EpicFilterValue>(options.epics.map((epic) => epic.id))
  if (options.hasIssuesWithoutEpic) epics.add('none')
  const assignees = new Set<AssigneeFilterValue>(options.assignees.map((user) => user.id))
  if (options.hasUnassigned) assignees.add('none')
  const keptEpics = filters.epics.filter((value) => epics.has(value))
  const keptAssignees = filters.assignees.filter((value) => assignees.has(value))
  if (keptEpics.length === filters.epics.length && keptAssignees.length === filters.assignees.length) return filters
  return { ...filters, epics: keptEpics, assignees: keptAssignees }
}

/** Add `value` to the list, or remove it when already present. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** Board filter state: `{ filters, update(patch), clear(), active }`. */
export function useBoardFilters() {
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const update = useCallback((patch: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...patch })), [])
  const clear = useCallback(() => setFilters(EMPTY_FILTERS), [])
  const active = useMemo(() => hasActiveFilters(filters), [filters])
  return { filters, update, clear, active }
}
