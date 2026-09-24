import { Activity as ActivityIcon, ChevronDown, History, RotateCw } from 'lucide-react'
import { useMemo } from 'react'
import { useProjectActivityInfinite } from '@/api/activity'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { useCurrentProject } from '@/components/layout/ProjectLayout'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { formatDate } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { useDocumentTitle } from '@/lib/hooks'
import { ActivityTimeline, ActivityTimelineSkeleton } from './ActivityTimeline'

/** Rows fetched per "Load more". */
const PAGE_SIZE = 50

/**
 * Project activity: the project's history, newest first, grouped by day. "Load more" fetches
 * older rows page by page (offset paging, so it is not capped by the API's 200-row limit).
 */
export function ProjectActivityPage() {
  const project = useCurrentProject()
  useDocumentTitle(`Activity · ${project.name}`)
  const activity = useProjectActivityInfinite(project.key, PAGE_SIZE)
  const rows = useMemo(() => activity.data?.pages.flat() ?? [], [activity.data])

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="Activity"
        breadcrumbs={[
          { label: 'Projects', to: '/projects' },
          { label: project.name, to: `/projects/${project.key}` },
          { label: 'Activity' },
        ]}
        description={`Everything that happened in ${project.name}, newest first.`}
      />

      {activity.isPending ? (
        <ActivityTimelineSkeleton />
      ) : activity.isError && rows.length === 0 ? (
        <ErrorState error={activity.error} title="Couldn’t load activity" onRetry={() => void activity.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon />}
          title="No activity yet"
          description="Changes to issues, comments, sprints and members will appear here as they happen."
        />
      ) : (
        <>
          <ActivityTimeline activities={rows} stickyHeadings />
          <div className="mt-8 flex flex-col items-center gap-2 border-t border-border pt-5">
            {activity.isFetchNextPageError ? (
              <>
                <p className="text-sm text-danger">{errorMessage(activity.error, 'Couldn’t load older activity')}</p>
                <Button size="sm" icon={<RotateCw />} onClick={() => void activity.fetchNextPage()}>
                  Try again
                </Button>
              </>
            ) : activity.hasNextPage ? (
              <Button
                icon={<ChevronDown />}
                loading={activity.isFetchingNextPage}
                onClick={() => void activity.fetchNextPage()}
                data-testid="activity-load-more"
              >
                Load more
              </Button>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-fg-subtle">
                <History className="size-4" aria-hidden />
                That’s everything since the project was created on {formatDate(project.createdAt)}.
              </p>
            )}
          </div>
        </>
      )}
    </PageContainer>
  )
}
