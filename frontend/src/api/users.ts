import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { qk } from './queryKeys'
import type { QueryOptions } from './queryClient'
import type { UserSummary } from './types'

/**
 * GET /users?query=&limit= — case-insensitive name/email search across all users
 * (empty query → first users by name). Keeps the previous result while typing.
 */
export function useUsers(query: string, options?: QueryOptions<UserSummary[]> & { limit?: number }) {
  const { limit = 20, ...rest } = options ?? {}
  const q = query.trim()
  return useQuery({
    queryKey: [...qk.users(q), limit],
    queryFn: ({ signal }) => api.get<UserSummary[]>('/users', { query: q, limit }, { signal }),
    placeholderData: keepPreviousData,
    ...rest,
  })
}
