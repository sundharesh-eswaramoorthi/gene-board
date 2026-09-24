import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { normalizeKey } from '@/lib/projectKey'
import { api, seg } from './client'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type { Activity } from './types'

/** GET /issues/{issueKey}/activity — issue history, newest first. */
export function useIssueActivity(issueKey: string | null | undefined, options?: QueryOptions<Activity[]>) {
  return useQuery({
    ...withCondition(!!issueKey, options),
    queryKey: qk.issueActivity(issueKey ?? ''),
    queryFn: ({ signal }) =>
      api.get<Activity[]>(`/issues/${seg(normalizeKey(issueKey!))}/activity`, undefined, { signal }),
  })
}

/**
 * GET /projects/{key}/activity?limit= — newest first (limit ≤ 200). Raising `limit` keeps the
 * previous rows on screen while loading ("load more" by limit).
 */
export function useProjectActivity(
  key: string | null | undefined,
  limit = 50,
  options?: QueryOptions<Activity[]>,
) {
  return useQuery({
    placeholderData: keepPreviousData,
    ...withCondition(!!key, options),
    queryKey: [...qk.projectActivity(key ?? ''), { limit }],
    queryFn: ({ signal }) =>
      api.get<Activity[]>(`/projects/${seg(key!)}/activity`, { limit, offset: 0 }, { signal }),
  })
}

/**
 * Paged project activity (offset-based, `pageSize` rows per page) for infinite "Load more".
 * `data.pages.flat()` gives the rows; `hasNextPage` is false once a short page arrives.
 */
export function useProjectActivityInfinite(key: string | null | undefined, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: [...qk.projectActivity(key ?? ''), 'infinite', pageSize],
    enabled: !!key,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api.get<Activity[]>(
        `/projects/${seg(key!)}/activity`,
        { limit: pageSize, offset: pageParam },
        { signal },
      ),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.reduce((n, p) => n + p.length, 0),
  })
}

/** GET /activity?limit= — recent activity across all the caller's projects, newest first. */
export function useActivityFeed(limit = 30, options?: QueryOptions<Activity[]>) {
  return useQuery({
    ...options,
    queryKey: [...qk.activityFeed(), { limit }],
    queryFn: ({ signal }) => api.get<Activity[]>('/activity', { limit }, { signal }),
  })
}
