import type { BoardResponse, ID, Issue, Status } from '@/api/types'
import { compareRank } from '@/lib/issueMeta'

/**
 * Pure board logic: grouping issues into columns, computing drag-and-drop neighbours and
 * applying optimistic moves to a cached `BoardResponse`. No React in here.
 */

/** The neighbours sent to `POST /issues/{key}/move` (SPEC §2 Rank). */
export interface MoveAnchors {
  /** Issue that will sit directly above the moved issue in the destination column. */
  prevIssueId: ID | null
  /** Issue that will sit directly below the moved issue in the destination column. */
  nextIssueId: ID | null
}

/** Where a dragged card lands: the destination column (status) plus its neighbours there. */
export interface MoveTarget extends MoveAnchors {
  status: Status
}

/** An optimistic move applied on top of board data until the server confirms it. */
export interface BoardMove extends MoveTarget {
  issueId: ID
}

/** Issues grouped per column: status id → issues ordered by rank. */
export type BoardColumns = ReadonlyMap<ID, readonly Issue[]>

/**
 * Group board issues into columns (one per status, in status order), each ordered by rank
 * (SPEC §2 Boards). Issues whose status is not a column of the board are left out.
 */
export function groupByStatus(statuses: readonly Status[], issues: readonly Issue[]): BoardColumns {
  const columns = new Map<ID, Issue[]>(statuses.map((s) => [s.id, []]))
  for (const issue of issues) columns.get(issue.status.id)?.push(issue)
  for (const list of columns.values()) list.sort(compareRank)
  return columns
}

/** Keep only the issues accepted by `predicate`, column by column. */
export function filterColumns(columns: BoardColumns, predicate: (issue: Issue) => boolean): BoardColumns {
  const out = new Map<ID, readonly Issue[]>()
  for (const [statusId, issues] of columns) out.set(statusId, issues.filter(predicate))
  return out
}

/**
 * Neighbours for a drop, computed against the **full** destination column so that cards hidden
 * by filters keep their place.
 *
 * `fullIds` is the destination column in rank order (it may contain the dragged card when it is
 * reordered inside its own column); `visibleIds` is what the user sees after the drop (filtered,
 * dragged card included). The card is anchored to its nearest *visible* neighbour: directly
 * after the visible card above it (the next card in the full order — possibly hidden — becomes
 * `next`), or, when it was dropped at the top, directly before the visible card below it. It
 * therefore appears exactly where it was dropped in the filtered view and moves past as few
 * hidden cards as possible. With no visible neighbour (an empty or fully filtered column) no
 * anchors are sent and the server keeps the issue's rank.
 */
export function computeAnchors(fullIds: readonly ID[], visibleIds: readonly ID[], draggedId: ID): MoveAnchors {
  const full = fullIds.filter((id) => id !== draggedId)
  const at = visibleIds.indexOf(draggedId)
  if (at >= 0) {
    for (let i = at - 1; i >= 0; i--) {
      const j = full.indexOf(visibleIds[i])
      if (j >= 0) return { prevIssueId: full[j], nextIssueId: full[j + 1] ?? null }
    }
    for (let i = at + 1; i < visibleIds.length; i++) {
      const j = full.indexOf(visibleIds[i])
      if (j >= 0) return { prevIssueId: full[j - 1] ?? null, nextIssueId: full[j] }
    }
  }
  return { prevIssueId: null, nextIssueId: null }
}

// ---------------------------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------------------------

/** The rank alphabet (byte order, like the server's `COLLATE "C"`). */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * A key strictly between `a` and `b` (`b === null` = unbounded above; `a` may be empty).
 * Fractional-index midpoint over {@link DIGITS}; never ends in '0' when the inputs don't.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA] + midpoint(a.slice(1), null)
}

/**
 * A client-side placeholder rank strictly between `lo` and `hi` (`''` = unbounded), used only to
 * order an optimistically moved card until the server's real rank arrives. Mirrors the server's
 * stale-client fallback: when `lo >= hi` the result goes right after `lo`.
 */
export function rankBetween(lo: string, hi: string): string {
  const upper = hi !== '' && (lo === '' || lo < hi) ? hi : null
  return midpoint(lo, upper)
}

// ---------------------------------------------------------------------------------------------
// Optimistic updates
// ---------------------------------------------------------------------------------------------

function replaceIssue(board: BoardResponse, issueId: ID, patch: Pick<Issue, 'status' | 'rank'>): BoardResponse {
  const index = board.issues.findIndex((i) => i.id === issueId)
  if (index < 0) return board
  const current = board.issues[index]
  if (current.status.id === patch.status.id && current.rank === patch.rank) return board
  const issues = board.issues.slice()
  issues[index] = { ...current, status: patch.status, rank: patch.rank }
  issues.sort(compareRank)
  return { ...board, issues }
}

/**
 * Apply a move to board data: the issue takes the destination status and a placeholder rank
 * between its anchors (resolved against the data it is applied to, so re-applying a move to
 * fresher data is idempotent in effect). No anchors → the rank is kept, like the server does.
 */
export function applyMove(board: BoardResponse, move: BoardMove): BoardResponse {
  const issue = board.issues.find((i) => i.id === move.issueId)
  if (!issue) return board
  const prev = move.prevIssueId != null ? board.issues.find((i) => i.id === move.prevIssueId) : undefined
  const next = move.nextIssueId != null ? board.issues.find((i) => i.id === move.nextIssueId) : undefined
  const rank = prev || next ? rankBetween(prev?.rank ?? '', next?.rank ?? '') : issue.rank
  return replaceIssue(board, issue.id, { status: move.status, rank })
}

/** Put an issue back to the status and rank it had in `original` (rollback of a failed move). */
export function restoreIssue(board: BoardResponse, original: Issue): BoardResponse {
  return replaceIssue(board, original.id, { status: original.status, rank: original.rank })
}
