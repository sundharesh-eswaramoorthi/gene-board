import { cn } from '@/lib/cn'
import { formatPoints } from '@/lib/issueMeta'

/** Props of `StoryPointsBadge`. */
export interface StoryPointsBadgeProps {
  points: number | null | undefined
  /** Render a "–" pill when points are null (default: render nothing). */
  showEmpty?: boolean
  className?: string
}

/** Round grey pill with the story point estimate. */
export function StoryPointsBadge({ points, showEmpty = false, className }: StoryPointsBadgeProps) {
  if (points == null && !showEmpty) return null
  return (
    <span
      title="Story points"
      aria-label={points == null ? 'No estimate' : `${formatPoints(points)} story points`}
      className={cn(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-neutral-subtle px-1.5 text-2xs font-semibold text-fg-muted tabular-nums',
        className,
      )}
    >
      {formatPoints(points, '–')}
    </span>
  )
}
