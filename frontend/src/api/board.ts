import { useQuery } from '@tanstack/react-query'
import { api, seg } from './client'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type { BacklogResponse, BoardResponse, EpicProgress } from './types'

/**
 * GET /projects/{key}/board — `{ project, statuses, sprint, issues }`. Scrum: issues of the
 * active sprint (sprint null → none); Kanban: all non-epic issues except long-resolved ones.
 */
export function useBoard(key: string | null | undefined, options?: QueryOptions<BoardResponse>) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.board(key ?? ''),
    queryFn: ({ signal }) => api.get<BoardResponse>(`/projects/${seg(key!)}/board`, undefined, { signal }),
  })
}

/** GET /projects/{key}/backlog — `{ sprints: { sprint, issues }[], backlog }`, all by rank. */
export function useBacklog(key: string | null | undefined, options?: QueryOptions<BacklogResponse>) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.backlog(key ?? ''),
    queryFn: ({ signal }) => api.get<BacklogResponse>(`/projects/${seg(key!)}/backlog`, undefined, { signal }),
  })
}

/** GET /projects/{key}/epics — `EpicProgress[]` ordered by epic rank. */
export function useEpics(key: string | null | undefined, options?: QueryOptions<EpicProgress[]>) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.epics(key ?? ''),
    queryFn: ({ signal }) => api.get<EpicProgress[]>(`/projects/${seg(key!)}/epics`, undefined, { signal }),
  })
}
