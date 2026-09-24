import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, seg } from './client'
import { invalidateProject } from './invalidate'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type {
  CompleteSprintInput,
  CompleteSprintResult,
  CreateSprintInput,
  ID,
  Sprint,
  SprintState,
  StartSprintInput,
  UpdateSprintInput,
} from './types'

/**
 * GET /projects/{key}/sprints?state= — active first, then planned by id, then completed
 * (newest first). `states` filters, e.g. `useSprints('GB', ['planned', 'active'])`.
 */
export function useSprints(
  key: string | null | undefined,
  states?: readonly SprintState[],
  options?: QueryOptions<Sprint[]>,
) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.sprints(key ?? '', states),
    queryFn: ({ signal }) =>
      api.get<Sprint[]>(`/projects/${seg(key!)}/sprints`, { state: states ?? undefined }, { signal }),
  })
}

/** POST /projects/{key}/sprints — `{ name?, goal?, startDate?, endDate? }` → planned Sprint. */
export function useCreateSprint(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSprintInput = {}) => api.post<Sprint>(`/projects/${seg(key)}/sprints`, input),
    onSuccess: () => invalidateProject(qc, key),
  })
}

/** PATCH /sprints/{id} — `{ id, name?, goal?, startDate?, endDate? }` (completed → 409). */
export function useUpdateSprint(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateSprintInput & { id: ID }) => api.patch<Sprint>(`/sprints/${id}`, input),
    onSuccess: () => invalidateProject(qc, key),
  })
}

/** DELETE /sprints/{id} — planned sprints only; their issues go to the backlog. Variable: id. */
export function useDeleteSprint(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: ID) => api.delete(`/sprints/${id}`),
    onSuccess: () => invalidateProject(qc, key),
  })
}

/** POST /sprints/{id}/start — `{ id, startDate, endDate, name?, goal? }` (409 if one is active). */
export function useStartSprint(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: StartSprintInput & { id: ID }) =>
      api.post<Sprint>(`/sprints/${id}/start`, input),
    onSuccess: () => invalidateProject(qc, key),
  })
}

/**
 * POST /sprints/{id}/complete — `{ id, target: 'backlog' | 'sprint' | 'new', sprintId? }`.
 * Open issues move to the target; returns counts and the target sprint.
 */
export function useCompleteSprint(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: CompleteSprintInput & { id: ID }) =>
      api.post<CompleteSprintResult>(`/sprints/${id}/complete`, input),
    onSuccess: () => invalidateProject(qc, key),
  })
}
