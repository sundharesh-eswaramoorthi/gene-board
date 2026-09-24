import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useMoveIssue } from '@/api/issues'
import { qk } from '@/api/queryKeys'
import type { BoardResponse, Issue } from '@/api/types'
import { toastError } from '@/components/ui/toast'
import { applyMove, restoreIssue, type BoardMove, type MoveTarget } from './boardModel'

interface PendingMove extends BoardMove {
  /** Identifies this move among concurrent ones. */
  token: number
}

/**
 * Board data with optimistic drag-and-drop.
 *
 * `moveIssue(issue, target)` updates the UI in the same render as the drop and then:
 * 1. writes the move into the board query cache (after cancelling in-flight board fetches);
 * 2. calls `POST /issues/{key}/move` with `statusId` (only when it changed) and the neighbours;
 * 3. on success does nothing visible — the shared mutation resolves only after the project
 *    queries refetched quietly in the background, so the cache already matches the server;
 * 4. on failure puts the issue back, toasts the error and refetches the board.
 *
 * Until the server confirms, each move is also kept as an overlay re-applied on top of whatever
 * the cache holds, so a refetch that races the request (realtime invalidation, window focus,
 * a cancelled fetch reverting its state) can never make the card jump back and forth.
 */
export function useOptimisticBoard(projectKey: string, data: BoardResponse | undefined) {
  const qc = useQueryClient()
  const { mutateAsync } = useMoveIssue()
  const [pending, setPending] = useState<readonly PendingMove[]>([])
  const nextToken = useRef(0)

  const board = useMemo(() => (data ? pending.reduce<BoardResponse>(applyMove, data) : undefined), [data, pending])

  const moveIssue = useCallback(
    (issue: Issue, target: MoveTarget) => {
      nextToken.current += 1
      const move: PendingMove = { ...target, issueId: issue.id, token: nextToken.current }
      const boardKey = qk.board(projectKey)
      setPending((moves) => [...moves, move])

      void (async () => {
        try {
          await qc.cancelQueries({ queryKey: boardKey })
          qc.setQueryData<BoardResponse>(boardKey, (old) => (old ? applyMove(old, move) : old))
          await mutateAsync({
            issueKey: issue.key,
            statusId: target.status.id !== issue.status.id ? target.status.id : undefined,
            prevIssueId: target.prevIssueId,
            nextIssueId: target.nextIssueId,
          })
        } catch (error) {
          qc.setQueryData<BoardResponse>(boardKey, (old) => (old ? restoreIssue(old, issue) : old))
          toastError(error, `Couldn’t move ${issue.key}`)
          void qc.invalidateQueries({ queryKey: boardKey })
        } finally {
          setPending((moves) => moves.filter((m) => m.token !== move.token))
        }
      })()
    },
    [projectKey, qc, mutateAsync],
  )

  return { board, moveIssue }
}
