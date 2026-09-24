import { Activity as ActivityIcon } from 'lucide-react'
import { useActivityFeed } from '@/api/activity'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { ActivityTimeline, ActivityTimelineSkeleton } from '@/features/activity/ActivityTimeline'

/** Rows shown in the dashboard feed. */
const FEED_LIMIT = 30

/** Latest activity across all the caller's projects, grouped by day. */
export function RecentActivity() {
  const feed = useActivityFeed(FEED_LIMIT)
  return (
    <section aria-labelledby="recent-activity-heading" className="min-w-0" data-testid="dashboard-activity">
      <h2 id="recent-activity-heading" className="mb-3 text-base font-semibold text-fg">
        Recent activity
      </h2>
      <div className="rounded-lg border border-border bg-surface p-4">
        {feed.isPending ? (
          <ActivityTimelineSkeleton rows={5} />
        ) : feed.isError ? (
          <ErrorState size="sm" error={feed.error} title="Couldn’t load activity" onRetry={() => void feed.refetch()} />
        ) : feed.data.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<ActivityIcon />}
            title="Nothing here yet"
            description="Updates from your projects — new issues, status changes, comments — will appear here."
          />
        ) : (
          <ActivityTimeline activities={feed.data} showProject />
        )}
      </div>
    </section>
  )
}
