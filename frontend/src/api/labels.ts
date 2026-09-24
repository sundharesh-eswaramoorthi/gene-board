import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, seg } from './client'
import { invalidateProject } from './invalidate'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type { CreateLabelInput, ID, Label, UpdateLabelInput } from './types'

/** GET /projects/{key}/labels — ordered by name. */
export function useLabels(key: string | null | undefined, options?: QueryOptions<Label[]>) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.labels(key ?? ''),
    queryFn: ({ signal }) => api.get<Label[]>(`/projects/${seg(key!)}/labels`, undefined, { signal }),
  })
}

/** POST /projects/{key}/labels (member) — `{ name, color? }` (409 duplicate name). */
export function useCreateLabel(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLabelInput) => api.post<Label>(`/projects/${seg(key)}/labels`, input),
    onSuccess: (label) => {
      qc.setQueryData<Label[]>(qk.labels(key), (old) =>
        old ? [...old.filter((l) => l.id !== label.id), label].sort((a, b) => a.name.localeCompare(b.name)) : old,
      )
      return invalidateProject(qc, key)
    },
  })
}

/** PATCH /projects/{key}/labels/{id} (admin) — `{ id, name?, color? }`. */
export function useUpdateLabel(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateLabelInput & { id: ID }) =>
      api.patch<Label>(`/projects/${seg(key)}/labels/${id}`, input),
    onSuccess: () => invalidateProject(qc, key),
  })
}

/** DELETE /projects/{key}/labels/{id} (admin) — variable is the label id. */
export function useDeleteLabel(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: ID) => api.delete(`/projects/${seg(key)}/labels/${id}`),
    onSuccess: () => invalidateProject(qc, key),
  })
}
