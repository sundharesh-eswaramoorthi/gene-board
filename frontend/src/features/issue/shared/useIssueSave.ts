import { useCallback, useOptimistic, useTransition } from 'react'
import { useUpdateIssue } from '@/api/issues'
import type { UpdateIssueInput } from '@/api/types'
import { toastSaveError } from './errors'

/** PATCHes one or more issue fields; resolves `false` (after toasting the error) on failure. */
export type SaveIssue = (input: UpdateIssueInput) => Promise<boolean>

/**
 * `save({ priority: 'high' })` — PATCH /issues/{key} with only the given fields. Never throws:
 * failures are toasted with the server message and reported as `false`.
 */
export function useIssueSave(issueKey: string): SaveIssue {
  const { mutateAsync } = useUpdateIssue(issueKey)
  return useCallback(
    async (input: UpdateIssueInput) => {
      try {
        await mutateAsync(input)
        return true
      } catch (err) {
        toastSaveError(err)
        return false
      }
    },
    [mutateAsync],
  )
}

/** Result of {@link useOptimisticField}. */
export interface OptimisticField<T> {
  /** The value to display: the pending value while saving, the server value otherwise. */
  value: T
  /** Show `next` immediately and persist it; reverts to the server value if saving fails. */
  commit: (next: T) => void
  /** True while the save (and the follow-up refetch) is in flight. */
  isPending: boolean
}

/**
 * Optimistic inline editing for one issue field (React 19 `useOptimistic` inside an async
 * transition). `persist` must not throw — use {@link useIssueSave}, which toasts failures.
 * When the transition settles the display falls back to the (refetched) server value, so a
 * failed save reverts on its own.
 */
export function useOptimisticField<T>(serverValue: T, persist: (next: T) => Promise<unknown>): OptimisticField<T> {
  const [isPending, startTransition] = useTransition()
  const [value, setOptimisticValue] = useOptimistic(serverValue)
  const commit = useCallback(
    (next: T) => {
      startTransition(async () => {
        setOptimisticValue(next)
        await persist(next)
      })
    },
    [persist, setOptimisticValue],
  )
  return { value, commit, isPending }
}
