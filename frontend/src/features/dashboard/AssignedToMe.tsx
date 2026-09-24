import { ArrowRight, CircleCheckBig } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { useProjects } from '@/api/projects'
import type { Issue } from '@/api/types'
import { DueDateLabel } from '@/components/issue/DueDateLabel'
import { IssueTypeIcon } from '@/components/issue/IssueTypeIcon'
import { PriorityIcon } from '@/components/issue/PriorityIcon'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { StatusLozenge } from '@/components/issue/StatusLozenge'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Skeleton } from '@/components/ui/Skeleton'
import { IssueOpenLink } from '@/features/search/IssueOpenLink'
import { useLocalStorageState } from '@/lib/hooks'
import { ASSIGNED_TO_ME_PATH, groupByProject, useAssignedToMe } from './dashboardData'

type View = 'project' | 'priority'

const VIEW_OPTIONS = [
  { value: 'project', label: 'By project' },
  { value: 'priority', label: 'By priority' },
] as const

/**
 * "Assigned to me": the caller's open (to do / in progress) issues across projects, grouped by
 * project (with counts) or as one list by priority. Rows open the issue modal.
 */
export function AssignedToMe() {
  const assigned = useAssignedToMe()
  const projects = useProjects()
  const [view, setView] = useLocalStorageState<View>('gb-dashboard-assigned-view', 'project')
  const issues = useMemo(() => assigned.data?.items ?? [], [assigned.data])
  const groups = useMemo(() => groupByProject(issues, projects.data), [issues, projects.data])
  const total = assigned.data?.total ?? 0
  const hidden = total - issues.length

  return (
    <section aria-labelledby="assigned-heading" className="min-w-0" data-testid="dashboard-assigned">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="assigned-heading" className="text-base font-semibold text-fg">
            Assigned to me
          </h2>
          {assigned.data && <Badge tone={total > 0 ? 'primary' : 'neutral'}>{total}</Badge>}
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && (
            <SegmentedControl
              size="sm"
              aria-label="Group assigned issues"
              value={view}
              onChange={setView}
              options={VIEW_OPTIONS}
            />
          )}
          <Link to={ASSIGNED_TO_ME_PATH} className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        {assigned.isPending ? (
          <AssignedSkeleton />
        ) : assigned.isError ? (
          <ErrorState size="sm" error={assigned.error} title="Couldn’t load your issues" onRetry={() => void assigned.refetch()} />
        ) : issues.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<CircleCheckBig />}
            title="You’re all caught up"
            description="No open issues are assigned to you. Issues assigned to you in any project will show up here."
          />
        ) : view === 'project' ? (
          <div className="divide-y divide-border">
            {groups.map((group) => (
              <div key={group.projectKey} className="py-2">
                <div className="flex items-center gap-2 px-4 pt-1 pb-1.5">
                  <ProjectAvatar project={group.project ?? { key: group.projectKey }} size="sm" />
                  <Link
                    to={`/projects/${group.projectKey}`}
                    className="truncate text-xs font-semibold tracking-wide text-fg-muted uppercase hover:text-fg hover:underline"
                  >
                    {group.project?.name ?? group.projectKey}
                  </Link>
                  <span className="text-xs text-fg-subtle tabular-nums">{group.issues.length}</span>
                </div>
                <ul className="px-1.5">
                  {group.issues.map((issue) => (
                    <AssignedRow key={issue.id} issue={issue} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="p-1.5">
            {issues.map((issue) => (
              <AssignedRow key={issue.id} issue={issue} showProject />
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <Link
            to={ASSIGNED_TO_ME_PATH}
            className="flex items-center justify-center gap-1 border-t border-border py-2.5 text-sm font-medium text-primary hover:bg-surface-hover"
          >
            View {hidden} more <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
    </section>
  )
}

function AssignedRow({ issue, showProject = false }: { issue: Issue; showProject?: boolean }) {
  return (
    <li>
      <IssueOpenLink
        issueKey={issue.key}
        className="flex min-h-12 items-center gap-3 rounded-sm px-2.5 py-1.5 transition-colors hover:bg-surface-hover"
      >
        <IssueTypeIcon type={issue.type} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-fg" title={issue.summary}>
            {issue.summary}
          </span>
          <span className="block truncate text-xs text-fg-subtle">
            {issue.key}
            {issue.parent && <> · {issue.parent.summary}</>}
            {showProject && issue.sprint && <> · {issue.sprint.name}</>}
          </span>
        </span>
        <DueDateLabel date={issue.dueDate} className="hidden text-xs sm:inline-flex" />
        <PriorityIcon priority={issue.priority} />
        <StatusLozenge status={issue.status} className="hidden sm:inline-flex" />
      </IssueOpenLink>
    </li>
  )
}

function AssignedSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-3" aria-busy="true" aria-label="Loading your issues">
      <Skeleton className="mb-2 h-3 w-24" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-3 px-1">
          <Skeleton className="size-4" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${45 + ((i * 21) % 40)}%` }} />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  )
}
