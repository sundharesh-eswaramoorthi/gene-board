import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, type QueryParams } from '@/api/client'
import { normalizeIssueSearch, useIssues } from '@/api/issues'
import { qk } from '@/api/queryKeys'
import type { ApiError, Issue, IssueSearchParams, Page } from '@/api'
import { useStatuses } from '@/api/statuses'
import { clientComparator, mixesStatusFilters, PAGE_SIZE, SORT_COLUMNS, toSearchParams, type IssueFilters } from './issueFilters'

/** Largest page the API serves (SPEC §5: limit max 200). */
const API_MAX_LIMIT = 200

/**
 * Columns the API cannot sort by (type, status, assignee) are sorted in the browser over every
 * matching issue. This caps how many matches are fetched for that; beyond it the table sorts
 * the first N matches (by key) and says so.
 */
export const CLIENT_SORT_CAP = 1000

/** One page of search results plus loading state. */
export interface IssueResults {
  /** Issues of the current page, in display order. */
  items: Issue[]
  /** Number of rows that can be paged through (capped for client-sorted searches). */
  total: number
  /** Total matches of the search (may exceed `total` when {@link IssueResults.truncated}). */
  matchCount: number
  /** True when a client-sorted search had more matches than {@link CLIENT_SORT_CAP}. */
  truncated: boolean
  /** First load (no data to show yet). */
  isPending: boolean
  /** A request is in flight (including background refreshes and page changes). */
  isFetching: boolean
  /** Showing the previous search's rows while the new one loads. */
  isPlaceholderData: boolean
  error: ApiError | null
  refetch: () => void
}

async function fetchAllMatches(
  params: IssueSearchParams,
  signal: AbortSignal,
): Promise<{ items: Issue[]; total: number }> {
  const query = (offset: number) =>
    api.get<Page<Issue>>(
      '/issues',
      { ...(params as QueryParams), sort: 'key', order: 'asc', limit: API_MAX_LIMIT, offset },
      { signal },
    )
  const first = await query(0)
  const target = Math.min(first.total, CLIENT_SORT_CAP)
  const offsets: number[] = []
  for (let offset = first.items.length; offset < target && first.items.length > 0; offset += API_MAX_LIMIT) {
    offsets.push(offset)
  }
  const rest = await Promise.all(offsets.map(query))
  const seen = new Set<number>()
  const items: Issue[] = []
  for (const issue of [first, ...rest].flatMap((p) => p.items)) {
    if (seen.has(issue.id) || items.length >= CLIENT_SORT_CAP) continue
    seen.add(issue.id)
    items.push(issue)
  }
  return { items, total: first.total }
}

/**
 * Loads the issues table for the given filters: server-side sorting + paging (50 per page)
 * where the API supports the column, otherwise all matches sorted in the browser. The previous
 * rows stay visible while a new page/sort/filter loads.
 */
export function useIssueResults(filters: IssueFilters, projectKey: string | null): IssueResults {
  // A mixed category + status filter is sent as status ids, which needs the project's statuses
  // (the filter bar loads them too, so this is normally a cache hit).
  const mixed = mixesStatusFilters(filters)
  const statuses = useStatuses(mixed ? (projectKey ?? filters.project) : null)
  const ready = !mixed || statuses.data != null
  const search = useMemo(
    () => normalizeIssueSearch(toSearchParams(filters, projectKey, statuses.data)),
    [filters, projectKey, statuses.data],
  )
  const column = SORT_COLUMNS[filters.sort]
  const serverSort = column.server
  const offset = (filters.page - 1) * PAGE_SIZE

  const paged = useIssues(
    { ...search, sort: serverSort ?? undefined, order: filters.order, limit: PAGE_SIZE, offset },
    { enabled: ready && serverSort != null, placeholderData: keepPreviousData },
  )

  const all = useQuery({
    // Lives under ['issues'] so every issue mutation / realtime event refreshes it.
    queryKey: [...qk.issues(), 'all-matches', search] as const,
    queryFn: ({ signal }) => fetchAllMatches(search, signal),
    enabled: ready && serverSort == null,
    placeholderData: keepPreviousData,
  })

  const clientPage = useMemo(() => {
    if (serverSort != null || !all.data) return null
    const sorted = [...all.data.items].sort(clientComparator(filters.sort, filters.order))
    return sorted.slice(offset, offset + PAGE_SIZE)
  }, [serverSort, all.data, filters.sort, filters.order, offset])

  // Without the statuses the search can't run (sending the category and the ids as they are
  // would AND them): report why (e.g. the project is gone) instead of loading forever.
  if (mixed && statuses.isError && statuses.data == null) {
    return {
      items: [],
      total: 0,
      matchCount: 0,
      truncated: false,
      isPending: false,
      isFetching: statuses.isFetching,
      isPlaceholderData: false,
      error: statuses.error,
      refetch: () => void statuses.refetch(),
    }
  }

  if (serverSort != null) {
    return {
      items: paged.data?.items ?? [],
      total: paged.data?.total ?? 0,
      matchCount: paged.data?.total ?? 0,
      truncated: false,
      isPending: paged.isPending,
      isFetching: paged.isFetching,
      isPlaceholderData: paged.isPlaceholderData,
      error: paged.error,
      refetch: () => void paged.refetch(),
    }
  }
  return {
    items: clientPage ?? [],
    total: all.data?.items.length ?? 0,
    matchCount: all.data?.total ?? 0,
    truncated: (all.data?.total ?? 0) > (all.data?.items.length ?? 0),
    isPending: all.isPending,
    isFetching: all.isFetching,
    isPlaceholderData: all.isPlaceholderData,
    error: all.error,
    refetch: () => void all.refetch(),
  }
}
