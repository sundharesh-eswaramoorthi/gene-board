import type { EpicProgress } from '@/api/types'
import { formatPoints } from '@/lib/issueMeta'
import { percent, pluralize } from '@/lib/format'

/** Child-issue counts of an epic, including the derived "to do" bucket. */
export interface EpicCounts {
  total: number
  done: number
  inProgress: number
  todo: number
  /** 0–100, rounded */
  percentDone: number
}

/** Counts by status category (`todo` = everything neither done nor in progress). */
export function epicCounts(progress: Pick<EpicProgress, 'total' | 'done' | 'inProgress'>): EpicCounts {
  const total = Math.max(0, progress.total)
  const done = Math.max(0, progress.done)
  const inProgress = Math.max(0, progress.inProgress)
  return {
    total,
    done,
    inProgress,
    todo: Math.max(0, total - done - inProgress),
    percentDone: percent(done, total),
  }
}

/** "3 of 8 done" / "No child issues". */
export function describeEpicProgress(progress: Pick<EpicProgress, 'total' | 'done' | 'inProgress'>): string {
  const c = epicCounts(progress)
  if (c.total === 0) return 'No child issues'
  return `${c.done} of ${pluralize(c.total, 'issue')} done`
}

/** "5 / 13 pts" — story points done out of the total estimate. */
export function describeEpicPoints(progress: Pick<EpicProgress, 'pointsDone' | 'pointsTotal'>): string {
  return `${formatPoints(progress.pointsDone, '0')} / ${formatPoints(progress.pointsTotal, '0')} pts`
}

/** True when the epic itself is in a done-category status. */
export function isEpicDone(progress: EpicProgress): boolean {
  return progress.epic.status.category === 'done'
}
