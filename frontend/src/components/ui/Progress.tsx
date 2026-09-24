import { cn } from '@/lib/cn'
import { percent } from '@/lib/format'

/** Colour of a progress bar / segment. */
export type ProgressTone = 'success' | 'info' | 'primary' | 'neutral' | 'warning' | 'danger'

const TONE_BG: Record<ProgressTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  primary: 'bg-primary',
  neutral: 'bg-neutral',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

/** Props of `ProgressBar`. */
export interface ProgressBarProps {
  value: number
  max: number
  tone?: ProgressTone
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/** Single-value progress bar (role="progressbar"). */
export function ProgressBar({ value, max, tone = 'success', size = 'sm', className, ...aria }: ProgressBarProps) {
  const pct = percent(Math.min(value, max), max)
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={aria['aria-label']}
      className={cn('w-full overflow-hidden rounded-full bg-neutral-subtle', size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      <div className={cn('h-full rounded-full transition-[width]', TONE_BG[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** One coloured segment of a SegmentedProgress. */
export interface ProgressSegment {
  value: number
  tone: ProgressTone
  label: string
}

/** Props of `SegmentedProgress`. */
export interface SegmentedProgressProps {
  /** Segments left → right, e.g. done (success), in progress (info). The rest is the track. */
  segments: readonly ProgressSegment[]
  total: number
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Stacked progress bar, Jira-epic style:
 * `<SegmentedProgress total={t} segments={[{ value: done, tone: 'success', label: 'Done' }, { value: inProgress, tone: 'info', label: 'In progress' }]} />`
 */
export function SegmentedProgress({ segments, total, size = 'sm', className }: SegmentedProgressProps) {
  const title = segments.map((s) => `${s.label}: ${s.value}`).join(' · ') + ` · Total: ${total}`
  return (
    <div
      role="img"
      aria-label={title}
      title={title}
      className={cn('flex w-full overflow-hidden rounded-full bg-neutral-subtle', size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      {total > 0 &&
        segments.map((s) =>
          s.value > 0 ? (
            <div key={s.label} className={cn('h-full', TONE_BG[s.tone])} style={{ width: `${(s.value / total) * 100}%` }} />
          ) : null,
        )}
    </div>
  )
}
