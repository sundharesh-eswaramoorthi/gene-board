import { useMemo } from 'react'
import type { Activity } from '@/api/types'
import { ActivityItem } from '@/components/issue/ActivityItem'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { formatDayHeading } from '@/lib/dates'
import { activityMarker, groupActivityByDay } from './activityMeta'

/** Props of {@link ActivityTimeline}. */
export interface ActivityTimelineProps {
  /** Rows, newest first. */
  activities: readonly Activity[]
  /** Show each row's project key (cross-project feeds). */
  showProject?: boolean
  /** Keep day headings pinned while scrolling (full-page timelines). */
  stickyHeadings?: boolean
  className?: string
}

/**
 * Activity rows grouped by day ("Today", "Yesterday", "Monday, Sep 21"): actor avatar with a
 * badge for the kind of change, the sentence ("Alex changed Status of GB-12 from To Do to In
 * Progress") with the issue key opening the issue (plain text once the issue is deleted), and
 * the relative time.
 */
export function ActivityTimeline({ activities, showProject = false, stickyHeadings = false, className }: ActivityTimelineProps) {
  const days = useMemo(() => groupActivityByDay(activities), [activities])
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {days.map((day) => {
        const headingId = `activity-day-${day.key}`
        return (
          <section key={day.key} aria-labelledby={headingId}>
            <h3
              id={headingId}
              className={cn(
                'z-10 text-xs font-semibold tracking-wide text-fg-subtle uppercase',
                stickyHeadings && 'sticky top-0 -mx-1 bg-surface/95 px-1 py-1.5 backdrop-blur-sm',
              )}
            >
              {formatDayHeading(day.date)}
            </h3>
            <ol className="mt-3 flex flex-col">
              {day.items.map((activity, i) => (
                <TimelineEntry key={activity.id} activity={activity} last={i === day.items.length - 1} showProject={showProject} />
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function TimelineEntry({ activity, last, showProject }: { activity: Activity; last: boolean; showProject: boolean }) {
  const marker = activityMarker(activity)
  const Icon = marker.icon
  return (
    <li className={cn('relative', !last && 'pb-5')} data-testid={`activity-${activity.id}`}>
      {!last && <span aria-hidden className="absolute top-10 bottom-1 left-4 w-px -translate-x-1/2 bg-border" />}
      <ActivityItem activity={activity} withIssue showProject={showProject} />
      <span
        aria-hidden
        title={marker.label}
        className={cn(
          'absolute top-5 left-5 flex size-4 items-center justify-center rounded-full ring-2 ring-surface',
          marker.className,
        )}
      >
        <Icon className="size-2.5" strokeWidth={2.5} />
      </span>
    </li>
  )
}

/** Loading placeholder shaped like the timeline. */
export function ActivityTimelineSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading activity">
      <Skeleton className="h-3 w-20" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
            <Skeleton className="h-3.5" style={{ width: `${55 + ((i * 19) % 40)}%` }} />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
