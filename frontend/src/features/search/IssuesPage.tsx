import { AlertTriangle, FilterX, Info, ListTodo, Plus, RotateCw, SearchX } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import type { Project } from '@/api/types'
import { useCreateIssueModal } from '@/app/ModalsProvider'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { useCurrentProject } from '@/components/layout/ProjectLayout'
import { Button, buttonClasses } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { errorMessage } from '@/lib/errors'
import { pluralize } from '@/lib/format'
import { useDocumentTitle } from '@/lib/hooks'
import { useProjectRole } from '@/lib/useProjectRole'
import { activeFilterCount, PAGE_SIZE, SORT_COLUMNS } from './issueFilters'
import { IssueFilterBar } from './IssueFilterBar'
import { IssuesTable } from './IssuesTable'
import { Pagination } from './Pagination'
import { CLIENT_SORT_CAP, useIssueResults } from './useIssueResults'
import { useIssueFilters } from './useIssueFilters'

/**
 * Issue search. Mounted at `/issues` (all the caller's projects, with a project filter) and at
 * `/projects/:projectKey/issues` (scoped to that project, with its statuses, members, labels
 * and sprints as filters). All filters, the sort and the page live in the URL.
 */
export function IssuesPage() {
  const { projectKey } = useParams()
  return projectKey ? <ProjectIssuesPage /> : <IssueSearch project={null} />
}

function ProjectIssuesPage() {
  const project = useCurrentProject()
  return <IssueSearch project={project} />
}

function IssueSearch({ project }: { project: Project | null }) {
  useDocumentTitle(project ? `Issues · ${project.name}` : 'Issues')
  const { filters, update, sortBy, setPage, clear } = useIssueFilters(project != null)
  const results = useIssueResults(filters, project?.key ?? null)
  const { canEdit } = useProjectRole(project?.key)
  const { openCreateIssue } = useCreateIssueModal()

  const pageCount = Math.max(1, Math.ceil(results.total / PAGE_SIZE))
  const settled = !results.isPending && !results.isPlaceholderData && !results.error
  // A shared link or deleted issues can leave the page past the end: snap back to the last page.
  useEffect(() => {
    if (settled && filters.page > pageCount) setPage(pageCount, { replace: true })
  }, [settled, filters.page, pageCount, setPage])

  const hasFilters = activeFilterCount(filters) > 0
  const showSkeleton = results.isPending || (results.isPlaceholderData && results.items.length === 0)
  // A failed refresh keeps the last rows (marked out of date), except after a 404: the searched
  // project is gone, or the viewer was removed from it, so its rows go too.
  const loadError = results.error && (results.items.length === 0 || results.error.status === 404) ? results.error : null
  const refreshError = loadError ? null : results.error
  const createIssue = project && canEdit ? () => openCreateIssue({ projectKey: project.key }) : undefined

  return (
    <PageContainer className="flex flex-col gap-3">
      <PageHeader
        title="Issues"
        className="pb-1"
        breadcrumbs={
          project
            ? [
                { label: 'Projects', to: '/projects' },
                { label: project.name, to: `/projects/${project.key}` },
                { label: 'Issues' },
              ]
            : undefined
        }
        description={project ? undefined : 'Search and filter issues across all your projects.'}
        actions={
          createIssue && (
            <Button variant="primary" icon={<Plus />} onClick={createIssue}>
              Create issue
            </Button>
          )
        }
      >
        <IssueFilterBar filters={filters} onChange={update} onClear={clear} project={project} />
      </PageHeader>

      {loadError ? (
        <div className="rounded-lg border border-border" data-testid="issues-error">
          <EmptyState
            icon={<AlertTriangle className="text-danger" />}
            title="Couldn’t load issues"
            description={errorMessage(loadError)}
            action={
              <>
                <Button size="sm" icon={<RotateCw />} onClick={results.refetch}>
                  Try again
                </Button>
                {((loadError.status === 400 && hasFilters) || (loadError.status === 404 && filters.project != null)) && (
                  <Button size="sm" variant="subtle" icon={<FilterX />} onClick={clear}>
                    Clear filters
                  </Button>
                )}
              </>
            }
          />
        </div>
      ) : !showSkeleton && results.total === 0 ? (
        <div className="rounded-lg border border-border" data-testid="issues-empty">
          {hasFilters ? (
            <EmptyState
              icon={<SearchX />}
              title="No issues match your search"
              description="Try different keywords or remove some filters."
              action={
                <Button icon={<FilterX />} onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : project ? (
            <EmptyState
              icon={<ListTodo />}
              title="This project has no issues yet"
              description="Create stories, tasks and bugs to start planning the work."
              action={
                createIssue && (
                  <Button variant="primary" icon={<Plus />} onClick={createIssue}>
                    Create issue
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState
              icon={<ListTodo />}
              title="No issues yet"
              description="Issues from all of your projects will show up here."
              action={
                <Link to="/projects" className={buttonClasses({ variant: 'secondary' })}>
                  Go to projects
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <>
          {refreshError && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm"
              data-testid="issues-refresh-error"
            >
              <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium text-fg">Couldn’t refresh issues, so this list may be out of date.</span>{' '}
                <span className="text-fg-muted">{errorMessage(refreshError)}</span>
              </p>
              <Button size="sm" icon={<RotateCw />} onClick={results.refetch}>
                Try again
              </Button>
            </div>
          )}
          <div className="flex min-h-5 items-center gap-2 text-sm text-fg-muted">
            {!showSkeleton && (
              <span className="tabular-nums" data-testid="issues-count">
                {pluralize(results.matchCount, 'issue')}
              </span>
            )}
            {results.isFetching && !showSkeleton && <Spinner size="xs" label="Updating results" />}
            {results.truncated && (
              <span className="inline-flex items-center gap-1 text-xs text-warning">
                <Info className="size-3.5" aria-hidden />
                Sorting by {SORT_COLUMNS[filters.sort].label.toLowerCase()} covers the first{' '}
                {CLIENT_SORT_CAP.toLocaleString()} matches. Narrow the search to see the rest.
              </span>
            )}
          </div>
          <IssuesTable
            issues={results.items}
            sort={filters.sort}
            order={filters.order}
            onSort={sortBy}
            loading={showSkeleton}
            stale={results.isPlaceholderData}
          />
          {!showSkeleton && (
            <Pagination page={filters.page} pageSize={PAGE_SIZE} total={results.total} onPageChange={setPage} />
          )}
        </>
      )}
    </PageContainer>
  )
}
