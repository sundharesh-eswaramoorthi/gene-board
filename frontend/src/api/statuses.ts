import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, seg } from './client'
import { invalidateProject } from './invalidate'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type { CreateStatusInput, ID, Status, UpdateStatusInput } from './types'

/** GET /projects/{key}/statuses — board columns ordered by position. */
export function useStatuses(key: string | null | undefined, options?: QueryOptions<Status[]>) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.statuses(key ?? ''),
    queryFn: ({ signal }) => api.get<Status[]>(`/projects/${seg(key!)}/statuses`, undefined, { signal }),
  })
}

/** POST /projects/{key}/statuses (admin) — `{ name, category, wipLimit? }`, appended last. */
export function useCreateStatus(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateStatusInput) => api.post<Status>(`/projects/${seg(key)}/statuses`, input),
    onSuccess: () => invalidateProject(qc, key),
  })
}

/** PATCH /projects/{key}/statuses/{id} (admin) — `{ id, name?, category?, wipLimit? }`. */
export function useUpdateStatus(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateStatusInput & { id: ID }) =>
      api.patch<Status>(`/projects/${seg(key)}/statuses/${id}`, input),
    // Issues linked from other projects show the renamed (or recategorised) status too.
    onSuccess: () => invalidateProject(qc, key, { linkedIssues: true }),
  })
}

/**
 * PUT /projects/{key}/statuses/order (admin) — variable is the full ordered list of status
 * ids (a permutation of all the project's statuses). The response is written to the cache.
 */
export function useReorderStatuses(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (statusIds: ID[]) =>
      api.put<Status[]>(`/projects/${seg(key)}/statuses/order`, { statusIds }),
    onSuccess: (statuses) => {
      qc.setQueryData(qk.statuses(key), statuses)
      return invalidateProject(qc, key)
    },
  })
}

/**
 * DELETE /projects/{key}/statuses/{id}?moveTo= (admin) — `{ id, moveTo? }`. `moveTo` is
 * required when issues use the status (409 without it); the last status can't be deleted.
 */
export function useDeleteStatus(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, moveTo }: { id: ID; moveTo?: ID | null }) =>
      api.delete(`/projects/${seg(key)}/statuses/${id}`, { moveTo }),
    onSuccess: () => invalidateProject(qc, key, { linkedIssues: true }),
  })
}
