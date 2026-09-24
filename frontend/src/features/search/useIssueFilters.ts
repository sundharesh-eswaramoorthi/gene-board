import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  EMPTY_FILTERS,
  parseFilters,
  SORT_COLUMNS,
  writeFilters,
  type IssueFilters,
  type SortColumn,
} from './issueFilters'

/** Options of a filter update. */
export interface FilterUpdateOptions {
  /** Replace the current history entry instead of pushing one (used while typing). */
  replace?: boolean
}

/** Result of {@link useIssueFilters}. */
export interface IssueFiltersApi {
  filters: IssueFilters
  /** Merge a patch into the filters. Any change other than `page` resets to page 1. */
  update: (patch: Partial<IssueFilters>, options?: FilterUpdateOptions) => void
  /** Sort by a column: toggles the order when it is already the sort column. */
  sortBy: (column: SortColumn) => void
  setPage: (page: number, options?: FilterUpdateOptions) => void
  /** Reset every narrowing filter (keeps the sort). */
  clear: () => void
}

/**
 * Issue-search filter state stored in the URL (see issueFilters.ts). Each discrete change
 * pushes a history entry so Back restores the previous search; the `issue` modal param and
 * other unrelated params are preserved.
 */
export function useIssueFilters(scoped: boolean): IssueFiltersApi {
  const location = useLocation()
  const navigate = useNavigate()
  const filters = useMemo(() => parseFilters(new URLSearchParams(location.search), scoped), [location.search, scoped])

  // Read the latest location at call time so callbacks stay stable and never write stale state.
  const locationRef = useRef(location)
  useEffect(() => {
    locationRef.current = location
  }, [location])

  const commit = useCallback(
    (next: IssueFilters, options: FilterUpdateOptions = {}) => {
      const loc = locationRef.current
      const params = writeFilters(new URLSearchParams(loc.search), next)
      const search = params.toString().replace(/%2C/g, ',')
      if (`?${search}` === loc.search || (search === '' && loc.search === '')) return
      navigate({ pathname: loc.pathname, search: search ? `?${search}` : '', hash: loc.hash }, { replace: options.replace })
    },
    [navigate],
  )

  const current = useCallback(() => parseFilters(new URLSearchParams(locationRef.current.search), scoped), [scoped])

  const update = useCallback(
    (patch: Partial<IssueFilters>, options?: FilterUpdateOptions) => {
      const base = current()
      commit({ ...base, ...patch, page: patch.page ?? 1 }, options)
    },
    [commit, current],
  )

  const sortBy = useCallback(
    (column: SortColumn) => {
      const base = current()
      const order =
        base.sort === column
          ? base.order === 'asc'
            ? 'desc'
            : 'asc'
          : SORT_COLUMNS[column].defaultOrder
      commit({ ...base, sort: column, order, page: 1 })
    },
    [commit, current],
  )

  const setPage = useCallback(
    (page: number, options?: FilterUpdateOptions) => commit({ ...current(), page: Math.max(1, page) }, options),
    [commit, current],
  )

  const clear = useCallback(() => {
    const base = current()
    commit({ ...EMPTY_FILTERS, sort: base.sort, order: base.order })
  }, [commit, current])

  return { filters, update, sortBy, setPage, clear }
}
