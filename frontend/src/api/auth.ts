import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, replaceSessionToken } from './client'
import { qk } from './queryKeys'
import type { QueryOptions } from './queryClient'
import type { AuthResponse, LoginInput, RegisterInput, UpdateMeInput, User } from './types'

/** POST /auth/login (used by AuthProvider; prefer `useAuth().login`). */
export function loginRequest(input: LoginInput): Promise<AuthResponse> {
  return api.post<AuthResponse>('/auth/login', input)
}

/** POST /auth/register (used by AuthProvider; prefer `useAuth().register`). */
export function registerRequest(input: RegisterInput): Promise<AuthResponse> {
  return api.post<AuthResponse>('/auth/register', input)
}

/** GET /auth/me — the signed-in user. Prefer `useAuth().user` in components. */
export function useMe(options?: QueryOptions<User>) {
  return useQuery({
    queryKey: qk.me(),
    queryFn: ({ signal }) => api.get<User>('/auth/me', undefined, { signal }),
    staleTime: 5 * 60_000,
    ...options,
  })
}

/**
 * PATCH /auth/me — `{ name? , currentPassword?, newPassword? }` → `{ token, user }`. A wrong
 * current password is a 400 `validation_error` with `fields.currentPassword`. The session
 * switches to the returned token before anything refetches: a password change revokes every
 * older token, including the one this request was sent with. Refreshes every cached query on
 * success (the user's name appears across projects).
 */
export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateMeInput) => {
      const res = await api.patch<AuthResponse>('/auth/me', input)
      replaceSessionToken(res.token)
      return res.user
    },
    onSuccess: (user) => {
      qc.setQueryData(qk.me(), user)
      return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    },
  })
}
