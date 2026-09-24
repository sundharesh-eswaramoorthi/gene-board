import { QueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { ApiError } from './client'

declare module '@tanstack/react-query' {
  interface Register {
    /** Every query/mutation error is an ApiError (network failures included, status 0). */
    defaultError: ApiError
  }
}

/** Extra options accepted by the query hooks (everything except key and fn). */
export type QueryOptions<T> = Omit<UseQueryOptions<T, ApiError, T>, 'queryKey' | 'queryFn'>

/** Creates the app's QueryClient: 30s stale time, no retries on 4xx, no mutation retries. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
          return failureCount < 2
        },
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/**
 * Merge caller options with a hook's own precondition (e.g. "key is present"): the query only
 * runs when `condition` holds AND the caller's `enabled` (boolean or function) allows it.
 */
export function withCondition<T>(condition: boolean, options?: QueryOptions<T>): QueryOptions<T> {
  const { enabled = true, ...rest } = options ?? {}
  return { ...rest, enabled: condition ? enabled : false }
}
