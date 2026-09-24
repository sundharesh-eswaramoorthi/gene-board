import type { StatusCategory } from '@/api/types'
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatPoints, STATUS_CATEGORIES, STATUS_CATEGORY_META } from '@/lib/issueMeta'
import type { PointsByCategory } from './model'

function pointsText(points: number): string {
  return `${formatPoints(points, '0')} ${points === 1 ? 'point' : 'points'}`
}

/** Jira-style story-point pills for a section: to do (grey), in progress (blue), done (green). */
export function PointsSummary({ points, className }: { points: PointsByCategory; className?: string }) {
  const label = STATUS_CATEGORIES.map((c) => `${STATUS_CATEGORY_META[c].label}: ${pointsText(points[c])}`).join(', ')
  return (
    <span role="group" aria-label={`Story points — ${label}`} className={cn('inline-flex items-center gap-1', className)}>
      {STATUS_CATEGORIES.map((c) => (
        <PointsPill key={c} category={c} points={points[c]} />
      ))}
    </span>
  )
}

function PointsPill({ category, points }: { category: StatusCategory; points: number }) {
  const meta = STATUS_CATEGORY_META[category]
  return (
    <Tooltip content={`${meta.label}: ${pointsText(points)}`}>
      <span
        aria-hidden
        className={cn(
          'inline-flex h-5 min-w-6 items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
          meta.lozengeClassName,
        )}
      >
        {formatPoints(points, '0')}
      </span>
    </Tooltip>
  )
}
