import { FolderKanban, FolderPlus, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useProjects } from '@/api/projects'
import type { ProjectType } from '@/api/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/Input'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { pluralize } from '@/lib/format'
import { useDocumentTitle } from '@/lib/hooks'
import { CreateProjectDialog } from './CreateProjectDialog'
import { defaultProjectOrder, filterProjects, sortProjects, type ProjectSort } from './projectSort'
import { ProjectsTable } from './ProjectsTable'

const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'scrum', label: 'Scrum' },
  { value: 'kanban', label: 'Kanban' },
] as const

/**
 * All projects the caller is a member of, with search, a type filter and sortable columns,
 * plus the "Create project" dialog (also opened by `/projects?create=1` from the top nav).
 */
export function ProjectsPage() {
  useDocumentTitle('Projects')
  const projects = useProjects()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<ProjectType | 'all'>('all')
  const [sort, setSort] = useState<ProjectSort>({ column: 'name', order: 'asc' })

  // `?create=1` (top nav → "Create project") opens the dialog; the param is then dropped so
  // Back / refresh don't reopen it.
  const [createSession, setCreateSession] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const wantsCreate = searchParams.get('create') === '1'
  if (wantsCreate && !createOpen) {
    setCreateOpen(true)
    setCreateSession((n) => n + 1)
  }
  useEffect(() => {
    if (!wantsCreate) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('create')
        return next
      },
      { replace: true },
    )
  }, [wantsCreate, setSearchParams])

  const openCreate = () => {
    setCreateSession((n) => n + 1)
    setCreateOpen(true)
  }

  const visible = useMemo(
    () => sortProjects(filterProjects(projects.data ?? [], query, type), sort),
    [projects.data, query, type, sort],
  )
  const total = projects.data?.length ?? 0
  const filtering = query.trim() !== '' || type !== 'all'

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Projects"
        description={projects.data ? `${pluralize(total, 'project')} you’re a member of` : undefined}
        actions={
          <Button variant="primary" icon={<FolderPlus />} onClick={openCreate} data-testid="projects-create">
            Create project
          </Button>
        }
      >
        {total > 0 && (
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search projects"
              className="w-full sm:w-64"
            />
            <SegmentedControl aria-label="Project type" value={type} onChange={setType} options={TYPE_FILTERS} />
          </>
        )}
      </PageHeader>

      {projects.isLoadingError ? (
        <div className="rounded-lg border border-border">
          <ErrorState error={projects.error} title="Couldn’t load projects" onRetry={() => void projects.refetch()} />
        </div>
      ) : !projects.isPending && total === 0 ? (
        <div className="rounded-lg border border-border">
          <EmptyState
            icon={<FolderKanban />}
            title="Create your first project"
            description="A project holds your team’s issues, board and backlog. You can also ask a teammate to add you to theirs."
            action={
              <Button variant="primary" icon={<FolderPlus />} onClick={openCreate}>
                Create project
              </Button>
            }
          />
        </div>
      ) : !projects.isPending && visible.length === 0 ? (
        <div className="rounded-lg border border-border">
          <EmptyState
            icon={<SearchX />}
            title="No projects match"
            description={query.trim() ? `Nothing matches “${query.trim()}”.` : 'No projects of this type.'}
            action={
              filtering && (
                <Button
                  onClick={() => {
                    setQuery('')
                    setType('all')
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </div>
      ) : (
        <ProjectsTable
          projects={visible}
          loading={projects.isPending}
          sort={sort}
          onSort={(column) =>
            setSort((prev) =>
              prev.column === column
                ? { column, order: prev.order === 'asc' ? 'desc' : 'asc' }
                : { column, order: defaultProjectOrder(column) },
            )
          }
        />
      )}

      {createSession > 0 && (
        <CreateProjectDialog key={createSession} open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
    </PageContainer>
  )
}
