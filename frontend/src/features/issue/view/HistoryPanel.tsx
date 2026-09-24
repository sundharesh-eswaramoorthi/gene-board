import { keepPreviousData } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { useIssueActivity } from '@/api/activity'
import { ActivityItem } from '@/components/issue'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { useIssueView } from './IssueViewContext'

/** Issue history (newest first): "Alex changed Status from To Do to In Progress · 5 minutes ago". */
export function HistoryPanel({ issueKey }: { issueKey: string }) {
  const { deleting } = useIssueView()
  const activity = useIssueActivity(issueKey, { enabled: !deleting, placeholderData: keepPreviousData })

  if (activity.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading history">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5" style={{ width: `${60 - i * 12}%` }} />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (activity.isError && !activity.data) {
    return <ErrorState size="sm" error={activity.error} title="Couldn’t load the history" onRetry={() => void activity.refetch()} />
  }
  if (activity.data.length === 0) {
    return <EmptyState size="sm" icon={<History />} title="No history yet" />
  }
  return (
    <ol className="flex flex-col gap-4">
      {activity.data.map((entry) => (
        <li key={entry.id}>
          <ActivityItem activity={entry} />
        </li>
      ))}
    </ol>
  )
}
