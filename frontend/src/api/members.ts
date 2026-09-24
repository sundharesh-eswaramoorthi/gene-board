import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, seg } from './client'
import { forgetProject, invalidateProject } from './invalidate'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type { AddMemberInput, ID, Member, Role, User } from './types'

/** GET /projects/{key}/members — ordered by user name. */
export function useMembers(key: string | null | undefined, options?: QueryOptions<Member[]>) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.members(key ?? ''),
    queryFn: ({ signal }) => api.get<Member[]>(`/projects/${seg(key!)}/members`, undefined, { signal }),
  })
}

/** POST /projects/{key}/members (admin) — `{ email, role }` (404 unknown user, 409 already member). */
export function useAddMember(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddMemberInput) => api.post<Member>(`/projects/${seg(key)}/members`, input),
    onSuccess: () => invalidateProject(qc, key, { projects: true }),
  })
}

/** PATCH /projects/{key}/members/{userId} (admin) — `{ userId, role }` (409 if no admin would remain). */
export function useUpdateMember(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: ID; role: Role }) =>
      api.patch<Member>(`/projects/${seg(key)}/members/${userId}`, { role }),
    onSuccess: () => invalidateProject(qc, key, { projects: true }),
  })
}

/**
 * DELETE /projects/{key}/members/{userId} (admin, or yourself to leave). 409 if it would
 * remove the last admin. Pass the user id as the variable. Removing yourself forgets the
 * project's cache instead of refetching it (you can no longer read it; see
 * {@link forgetProject}) — navigate away afterwards.
 */
export function useRemoveMember(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: ID) => api.delete(`/projects/${seg(key)}/members/${userId}`),
    onSuccess: (_data, userId) =>
      qc.getQueryData<User>(qk.me())?.id === userId
        ? forgetProject(qc, key)
        : invalidateProject(qc, key, { projects: true }),
  })
}
