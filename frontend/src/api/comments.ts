import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { normalizeKey, projectKeyOf } from '@/lib/projectKey'
import { api, seg } from './client'
import { invalidateProject } from './invalidate'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type { Comment, ID } from './types'

/** GET /issues/{issueKey}/comments — oldest first. */
export function useComments(issueKey: string | null | undefined, options?: QueryOptions<Comment[]>) {
  return useQuery({
    ...withCondition(!!issueKey, options),
    queryKey: qk.comments(issueKey ?? ''),
    queryFn: ({ signal }) =>
      api.get<Comment[]>(`/issues/${seg(normalizeKey(issueKey!))}/comments`, undefined, { signal }),
  })
}

/** POST /issues/{issueKey}/comments — variable is the Markdown body (1–10000 chars). */
export function useAddComment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      api.post<Comment>(`/issues/${seg(normalizeKey(issueKey))}/comments`, { body }),
    onSuccess: (comment) => {
      qc.setQueryData<Comment[]>(qk.comments(issueKey), (old) =>
        old && !old.some((c) => c.id === comment.id) ? [...old, comment] : old,
      )
      return invalidateProject(qc, projectKeyOf(issueKey))
    },
  })
}

/** PATCH /comments/{id} (author only) — `{ id, body }`. */
export function useUpdateComment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: ID; body: string }) => api.patch<Comment>(`/comments/${id}`, { body }),
    onSuccess: (comment) => {
      qc.setQueryData<Comment[]>(qk.comments(issueKey), (old) =>
        old?.map((c) => (c.id === comment.id ? comment : c)),
      )
      return invalidateProject(qc, projectKeyOf(issueKey))
    },
  })
}

/** DELETE /comments/{id} (author or project admin) — variable is the comment id. */
export function useDeleteComment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: ID) => api.delete(`/comments/${id}`),
    onSuccess: (_data, id) => {
      qc.setQueryData<Comment[]>(qk.comments(issueKey), (old) => old?.filter((c) => c.id !== id))
      return invalidateProject(qc, projectKeyOf(issueKey))
    },
  })
}
