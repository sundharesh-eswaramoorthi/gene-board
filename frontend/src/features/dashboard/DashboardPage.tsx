import { format } from 'date-fns'
import { FolderPlus } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { useProjects } from '@/api/projects'
import { useCurrentUser } from '@/auth/AuthProvider'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { buttonClasses } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/EmptyState'
import { pluralize } from '@/lib/format'
import { useDocumentTitle } from '@/lib/hooks'
import { useRecentProjectKeys } from '@/lib/recentProjects'
import { AssignedToMe } from './AssignedToMe'
import { greetingFor, orderRecentProjects, useAssignedToMe } from './dashboardData'
import { GettingStarted } from './GettingStarted'
import { RecentActivity } from './RecentActivity'
import { RecentProjects, RecentProjectsSkeleton } from './RecentProjects'

/** Number of project cards on the dashboard. */
const RECENT_PROJECT_CARDS = 4

/**
 * "Your work": a greeting, recent project cards, the caller's open assigned issues (grouped by
 * project) and recent activity across projects. First-time users get a getting-started panel.
 */
export function DashboardPage() {
  useDocumentTitle('Your work')
  const user = useCurrentUser()
  const projects = useProjects()
  const recentKeys = useRecentProjectKeys()
  const assigned = useAssignedToMe()

  const now = new Date()
  const firstName = user.name.trim().split(/\s+/)[0] || user.name

  const recentProjects = useMemo(
    () => orderRecentProjects(projects.data ?? [], recentKeys, RECENT_PROJECT_CARDS),
    [projects.data, recentKeys],
  )
  // Per-project counts are only exact when every assigned issue was loaded.
  const assignedCounts = useMemo(() => {
    const data = assigned.data
    if (!data || data.total > data.items.length) return undefined
    const counts = new Map<string, number>()
    for (const issue of data.items) counts.set(issue.projectKey, (counts.get(issue.projectKey) ?? 0) + 1)
    return counts
  }, [assigned.data])

  const hasProjects = (projects.data?.length ?? 0) > 0
  const openCount = assigned.data?.total

  return (
    <PageContainer size="wide" className="flex flex-col gap-8 pb-10">
      <PageHeader
        className="pb-0"
        title={`${greetingFor(now)}, ${firstName}`}
        description={
          <>
            {format(now, 'EEEE, MMMM d')}
            {hasProjects && openCount != null && (
              <> · {openCount === 0 ? 'no open issues assigned to you' : `${pluralize(openCount, 'open issue')} assigned to you`}</>
            )}
          </>
        }
        actions={
          hasProjects && (
            <Link to="/projects?create=1" className={buttonClasses({ variant: 'secondary' })}>
              <FolderPlus aria-hidden />
              Create project
            </Link>
          )
        }
      />

      {projects.isPending ? (
        <RecentProjectsSkeleton />
      ) : projects.isError ? (
        <div className="rounded-lg border border-border">
          <ErrorState error={projects.error} title="Couldn’t load your projects" onRetry={() => void projects.refetch()} />
        </div>
      ) : !hasProjects ? (
        <GettingStarted name={firstName} />
      ) : (
        <>
          <RecentProjects
            projects={recentProjects}
            assignedCounts={assignedCounts}
            totalProjects={projects.data.length}
          />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
            <AssignedToMe />
            <RecentActivity />
          </div>
        </>
      )}
    </PageContainer>
  )
}
