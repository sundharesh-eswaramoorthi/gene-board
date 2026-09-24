import { ApiError } from '@/api/client'

/** Best human-readable message for any thrown value (ApiError, Error, string). */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) return error.message || fallback
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'string' && error) return error
  return fallback
}

/** Field errors of a `validation_error` ApiError (`{ summary: 'is required' }`), else `{}`. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError && error.fields ? error.fields : {}
}

/** True when `error` is an ApiError with the given HTTP status. */
export function isApiStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status
}
