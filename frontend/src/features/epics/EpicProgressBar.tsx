import type { EpicProgress } from '@/api/types'
import { cn } from '@/lib/cn'
import { epicCounts } from './epicProgress'

/** Props of `EpicProgressBar`. */
export interface EpicProgressBarProps {
  progress: Pick<EpicProgress, 'total' | 'done' | 'inProgress'>
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Stacked epic progress bar, Jira style: done (green), in progress (blue), and the remaining
 * to-do share as the grey track. Announces all three counts to assistive technology.
 */
export function EpicProgressBar({ progress, size = 'sm', className }: EpicProgressBarProps) {
  const c = epicCounts(progress)
  const label =
    c.total === 0
      ? 'No child issues'
      : `${c.done} done, ${c.inProgress} in progress, ${c.todo} to do (${c.percentDone}% complete)`
  const width = (value: number) => `${c.total > 0 ? (value / c.total) * 100 : 0}%`
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'flex w-full overflow-hidden rounded-full bg-neutral-subtle',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
    >
      {c.done > 0 && <div className="h-full bg-success transition-[width]" style={{ width: width(c.done) }} />}
      {c.inProgress > 0 && <div className="h-full bg-info transition-[width]" style={{ width: width(c.inProgress) }} />}
    </div>
  )
}
