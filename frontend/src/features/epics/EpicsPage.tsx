import { ChevronsDownUp, ChevronsUpDown, Plus, SearchX, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useEpics } from '@/api/board'
import type { EpicProgress, ID, Project } from '@/api/types'
import { useCreateIssueModal } from '@/app/ModalsProvider'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { useCurrentProject } from '@/components/layout/ProjectLayout'
import { Badge, Button, EmptyState, ErrorState, SearchInput, SegmentedControl, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useDocumentTitle, useLocalStorageState } from '@/lib/hooks'
import { useProjectRole } from '@/lib/useProjectRole'
import { EPIC_COLUMNS } from './epicColumns'
import { isEpicDone } from './epicProgress'
import { EpicRow } from './EpicRow'

type EpicView = 'all' | 'open' | 'done'

const VIEW_STORAGE_KEY = 'gb-epics-view'

function matchesQuery(p: EpicProgress, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return p.epic.key.toLowerCase().includes(q) || p.epic.summary.toLowerCase().includes(q)
}

function matchesView(p: EpicProgress, view: EpicView): boolean {
  if (view === 'all') return true
  return view === 'done' ? isEpicDone(p) : !isEpicDone(p)
}

/** Epics page: every epic of the project with its progress; rows expand to their child issues. */
export function EpicsPage() {
  const project = useCurrentProject()
  // Fresh search / expansion state per project.
  return <EpicsView key={project.key} project={project} />
}

function EpicsView({ project }: { project: Project }) {
  const { canEdit } = useProjectRole(project.key)
  const { openCreateIssue } = useCreateIssueModal()
  const epics = useEpics(project.key)
  const [query, setQuery] = useState('')
  const [view, setView] = useLocalStorageState<EpicView>(VIEW_STORAGE_KEY, 'all')
  const [expanded, setExpanded] = useState<ReadonlySet<ID>>(() => new Set())
  useDocumentTitle(`Epics – ${project.name}`)

  const all = useMemo(() => epics.data ?? [], [epics.data])
  const counts = useMemo(() => {
    const done = all.filter(isEpicDone).length
    return { all: all.length, open: all.length - done, done }
  }, [all])
  const visible = useMemo(() => all.filter((p) => matchesView(p, view) && matchesQuery(p, query)), [all, view, query])

  const createEpic = () => openCreateIssue({ projectKey: project.key, type: 'epic' })
  const toggle = (id: ID) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allExpanded = visible.length > 0 && visible.every((p) => expanded.has(p.epic.id))
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(visible.map((p) => p.epic.id)))
  const clearFilters = () => {
    setQuery('')
    setView('all')
  }

  let content
  if (epics.isPending) {
    content = <EpicsSkeleton />
  } else if (epics.isLoadingError) {
    content = (
      <div className="rounded-lg border border-border bg-surface">
        <ErrorState error={epics.error} title="Couldn’t load epics" onRetry={() => void epics.refetch()} />
      </div>
    )
  } else if (all.length === 0) {
    content = (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={<Zap />}
          title="No epics yet"
          description="Epics group stories, tasks and bugs into larger bodies of work, so you can track progress towards bigger goals."
          action={
            canEdit && (
              <Button variant="primary" icon={<Plus />} onClick={createEpic}>
                Create epic
              </Button>
            )
          }
        />
      </div>
    )
  } else if (visible.length === 0) {
    content = (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          size="sm"
          icon={<SearchX />}
          title="No epics match your filters"
          action={
            <Button size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      </div>
    )
  } else {
    content = (
      <div className="@container overflow-hidden rounded-lg border border-border bg-surface">
        <ListHeader />
        <ul aria-label="Epics" data-testid="epics-list">
          {visible.map((p) => (
            <EpicRow
              key={p.epic.id}
              projectKey={project.key}
              progress={p}
              expanded={expanded.has(p.epic.id)}
              onToggle={() => toggle(p.epic.id)}
              canEdit={canEdit}
            />
          ))}
        </ul>
      </div>
    )
  }

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Epics"
        breadcrumbs={[
          { label: 'Projects', to: '/projects' },
          { label: project.name, to: `/projects/${project.key}` },
          { label: 'Epics' },
        ]}
        description="Large bodies of work and how far along they are."
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus />} onClick={createEpic} data-testid="epics-create">
              Create epic
            </Button>
          ) : (
            <Badge tone="neutral" shape="square" size="md">
              Read only
            </Badge>
          )
        }
      >
        {all.length > 0 && (
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search epics"
              className="w-full sm:w-64"
            />
            <SegmentedControl
              aria-label="Show epics"
              value={view}
              onChange={setView}
              options={[
                { value: 'all', label: <ViewLabel label="All" count={counts.all} /> },
                { value: 'open', label: <ViewLabel label="Open" count={counts.open} /> },
                { value: 'done', label: <ViewLabel label="Done" count={counts.done} /> },
              ]}
            />
            <Button
              variant="subtle"
              size="sm"
              className="ml-auto"
              icon={allExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
              onClick={toggleAll}
              disabled={visible.length === 0}
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </Button>
          </>
        )}
      </PageHeader>
      {content}
    </PageContainer>
  )
}

function ViewLabel({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}
      <span className="text-2xs text-fg-subtle tabular-nums">{count}</span>
    </>
  )
}

function ListHeader() {
  const cell = 'text-2xs font-semibold tracking-wide text-fg-subtle uppercase'
  return (
    <div aria-hidden className="hidden h-8 items-center gap-3 border-b border-border bg-surface-sunken px-3 @lg:flex">
      {/* offset = chevron (24px) + gap + colour bar (4px) + gap */}
      <span className={cn(cell, 'min-w-0 flex-1 pl-13')}>Epic</span>
      <span className={cn(cell, EPIC_COLUMNS.status)}>Status</span>
      <span className={cn(cell, EPIC_COLUMNS.progress)}>Progress</span>
      <span className={cn(cell, EPIC_COLUMNS.points)}>Points</span>
      <span className={cn(cell, EPIC_COLUMNS.due)}>Due</span>
      <span className={cn(cell, EPIC_COLUMNS.assignee)} />
    </div>
  )
}

function EpicsSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-surface"
      aria-busy="true"
      aria-label="Loading epics"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b border-border px-3 last:border-b-0">
          <Skeleton className="size-5" />
          <Skeleton className="h-8 w-1 rounded-full" />
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${40 + ((i * 13) % 30)}%` }} />
          <div className="ml-auto hidden w-44 flex-col gap-1.5 md:flex">
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
