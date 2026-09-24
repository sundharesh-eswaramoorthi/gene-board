import { useMemo } from 'react'
import type { BoardResponse, ID, Issue } from '@/api/types'
import {
  createIssueMatcher,
  deriveFilterOptions,
  epicOf,
  hasActiveFilters,
  pruneFilters,
  type BoardFilterOptions,
  type BoardFilters,
  type EpicOption,
} from './boardFilters'
import { filterColumns, groupByStatus, type BoardColumns } from './boardModel'

/** Everything the board renders, derived from the board data and the filters. */
export interface BoardView {
  /** All issues per column, rank order. */
  columns: BoardColumns
  /** Issues per column after the filters. */
  visibleColumns: BoardColumns
  /** Epic of each issue (issue id → epic); issues without an epic are absent. */
  epics: ReadonlyMap<ID, EpicOption>
  options: BoardFilterOptions
  filtered: boolean
  shownCount: number
  totalCount: number
}

function countIssues(columns: BoardColumns): number {
  let n = 0
  for (const list of columns.values()) n += list.length
  return n
}

/** Group, derive filter options and apply the filters (memoised per input). */
export function useBoardView(board: BoardResponse | undefined, filters: BoardFilters, meId: ID): BoardView | null {
  const base = useMemo(() => {
    if (!board) return null
    // For epic lookups: the board's issues, plus the parents of subtasks that aren't on it.
    const byId = new Map<ID, Issue>([...board.parents, ...board.issues].map((issue) => [issue.id, issue]))
    const epics = new Map<ID, EpicOption>()
    for (const issue of board.issues) {
      const epic = epicOf(issue, byId)
      if (epic) epics.set(issue.id, epic)
    }
    const columns = groupByStatus(board.statuses, board.issues)
    return { byId, epics, columns, options: deriveFilterOptions(board.issues, byId), totalCount: countIssues(columns) }
  }, [board])

  return useMemo(() => {
    if (!base) return null
    // Epics and people no longer on the board have no control in the toolbar: ignore them.
    const effective = pruneFilters(filters, base.options)
    const filtered = hasActiveFilters(effective)
    const visibleColumns = filtered
      ? filterColumns(base.columns, createIssueMatcher(effective, { meId, byId: base.byId }))
      : base.columns
    return {
      columns: base.columns,
      visibleColumns,
      epics: base.epics,
      options: base.options,
      filtered,
      shownCount: filtered ? countIssues(visibleColumns) : base.totalCount,
      totalCount: base.totalCount,
    }
  }, [base, filters, meId])
}
