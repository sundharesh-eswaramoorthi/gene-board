import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, History, Info, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useBacklog, useEpics } from '@/api/board'
import { useIssues, useMoveIssue } from '@/api/issues'
import { qk } from '@/api/queryKeys'
import { useCreateSprint, useDeleteSprint } from '@/api/sprints'
import { useStatuses } from '@/api/statuses'
import type { Issue, Project, Sprint } from '@/api/types'
import { useCreateIssueModal, useIssueModal } from '@/app/ModalsProvider'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCurrentProject } from '@/components/layout/ProjectLayout'
import {
  Badge,
  Button,
  buttonClasses,
  ErrorState,
  Skeleton,
  SkeletonRows,
  toast,
  toastError,
  useConfirm,
} from '@/components/ui'
import { CompleteSprintDialog } from '@/features/board/CompleteSprintDialog'
import { formatDateRange } from '@/lib/dates'
import { useDocumentTitle, useLocalStorageState } from '@/lib/hooks'
import { pluralize } from '@/lib/format'
import { useProjectRole } from '@/lib/useProjectRole'
import { BacklogActionsContext, type BacklogActions } from './BacklogContext'
import { BacklogLists } from './BacklogLists'
import { BacklogToolbar } from './BacklogToolbar'
import { EpicsPanel } from './EpicsPanel'
import {
  applyPendingMoves,
  buildContainers,
  containerSprintId,
  currentNeighbours,
  EMPTY_FILTERS,
  matchesFilters,
  resolveNeighbours,
  type BacklogContainer,
  type BacklogFilters,
  type ContainerId,
  type PendingMove,
} from './model'
import { EditSprintDialog, StartSprintDialog } from './SprintDialogs'
import type { DropResult } from './useBacklogDnd'

const PANEL_STORAGE_KEY = 'gb-backlog-epics-panel'

type SprintDialogState = { type: 'start' | 'edit'; sprint: Sprint }

/** The Epics panel starts open on wide screens only (the choice is then remembered). */
const defaultPanelOpen = typeof window !== 'undefined' && window.matchMedia('(min-width: 1200px)').matches

/**
 * Backlog (docs/FRONTEND.md §3): stacked sprint sections (active, planned) and the Backlog, with
 * drag-and-drop planning, inline create, sprint lifecycle actions, an Epics panel and quick
 * filters. Kanban projects get one flat ranked list instead of sprints.
 */
export function BacklogPage() {
  const project = useCurrentProject()
  // Fresh state (filters, optimistic moves, dialogs) per project.
  return <BacklogView key={project.key} project={project} />
}

function BacklogView({ project }: { project: Project }) {
  const projectKey = project.key
  const flat = project.type === 'kanban'
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { canEdit } = useProjectRole(projectKey)
  const { openIssue, currentIssueKey } = useIssueModal()
  const { openCreateIssue } = useCreateIssueModal()
  const backlog = useBacklog(projectKey)
  const epics = useEpics(projectKey)
  const move = useMoveIssue()
  const createSprint = useCreateSprint(projectKey)
  const deleteSprint = useDeleteSprint(projectKey)
  useDocumentTitle(`Backlog – ${project.name}`)

  const [filters, setFilters] = useState<BacklogFilters>(EMPTY_FILTERS)
  const [panelOpen, setPanelOpen] = useLocalStorageState(PANEL_STORAGE_KEY, defaultPanelOpen)
  const [collapsed, setCollapsed] = useLocalStorageState<ContainerId[]>(`gb-backlog-collapsed-${projectKey}`, [])
  const [dialog, setDialog] = useState<SprintDialogState | null>(null)
  const [completing, setCompleting] = useState<Sprint | null>(null)
  const [pending, setPending] = useState<PendingMove[]>([])
  const moveToken = useRef(0)

  const serverContainers = useMemo(
    () => (backlog.data ? buildContainers(backlog.data, flat) : []),
    [backlog.data, flat],
  )
  // Optimistic view: server lists with not-yet-confirmed drops replayed on top.
  const containers = useMemo(() => applyPendingMoves(serverContainers, pending), [serverContainers, pending])

  // An epic filter whose epic no longer exists falls back to "all issues".
  const epicList = epics.data
  const staleEpic = typeof filters.epic === 'number' && !!epicList && !epicList.some((p) => p.epic.id === filters.epic)
  const effectiveFilters = useMemo(() => (staleEpic ? { ...filters, epic: null } : filters), [filters, staleEpic])
  const selectedEpic =
    typeof effectiveFilters.epic === 'number'
      ? (epicList?.find((p) => p.epic.id === effectiveFilters.epic)?.epic ?? null)
      : null

  const counts = useMemo(() => {
    let total = 0
    let visible = 0
    for (const c of containers) {
      total += c.issues.length
      for (const issue of c.issues) if (matchesFilters(issue, effectiveFilters)) visible++
    }
    return { total, visible }
  }, [containers, effectiveFilters])

  const handleDrop = ({ issueKey, from, to, aboveKey, belowKey }: DropResult) => {
    const source = containers.find((c) => c.id === from)
    const target = containers.find((c) => c.id === to)
    const issue = source?.issues.find((i) => i.key === issueKey)
    if (!source || !target || !issue) return

    const idOf = (key: string | null) =>
      key ? (target.issues.find((i) => i.key === key)?.id ?? null) : null
    const full = target.issues.filter((i) => i.id !== issue.id)
    const { prevId, nextId } = resolveNeighbours(full, idOf(aboveKey), idOf(belowKey))

    if (from === to) {
      const current = currentNeighbours(source.issues, issue.id)
      if (current && current.prevId === prevId && current.nextId === nextId) return
    }
    const sprintId = from !== to ? containerSprintId(target) : undefined

    const token = ++moveToken.current
    setPending((p) => [...p, { token, issueId: issue.id, to, prevId, nextId }])
    move
      .mutateAsync({
        issueKey,
        prevIssueId: prevId,
        nextIssueId: nextId,
        ...(sprintId !== undefined && { sprintId }),
      })
      .catch((err: unknown) => {
        toastError(err, `Couldn’t move ${issueKey}`)
        void qc.invalidateQueries({ queryKey: qk.backlog(projectKey) })
      })
      .finally(() => setPending((p) => p.filter((m) => m.token !== token)))
  }

  const toggleCollapsed = (id: ContainerId) =>
    setCollapsed((prev) => {
      const known = prev.filter((x) => containers.some((c) => c.id === x))
      return known.includes(id) ? known.filter((x) => x !== id) : [...known, id]
    })

  const handleDeleteSprint = (container: BacklogContainer) => {
    if (container.sprint) confirmDeleteSprint(container.sprint, container.issues.length)
  }

  const confirmDeleteSprint = (sprint: Sprint, n: number) => {
    void confirm({
      title: `Delete ${sprint.name}?`,
      description:
        n > 0
          ? `Its ${pluralize(n, 'issue')} will move to the backlog. The sprint can’t be restored.`
          : 'The sprint has no issues. It can’t be restored.',
      confirmLabel: 'Delete sprint',
      tone: 'danger',
      onConfirm: async () => {
        await deleteSprint.mutateAsync(sprint.id)
        toast.success(`${sprint.name} deleted`)
      },
    })
  }

  const actions: BacklogActions = {
    projectKey,
    canEdit,
    hasActiveSprint: containers.some((c) => c.sprint?.state === 'active'),
    currentIssueKey,
    openIssue,
    startSprint: (sprint) => setDialog({ type: 'start', sprint }),
    editSprint: (sprint) => setDialog({ type: 'edit', sprint }),
    deleteSprint: handleDeleteSprint,
    completeSprint: setCompleting,
    createSprint: () =>
      createSprint.mutate(
        {},
        {
          onSuccess: (sprint) => toast.success(`${sprint.name} created`),
          onError: (err) => toastError(err, 'Couldn’t create a sprint'),
        },
      ),
    creatingSprint: createSprint.isPending,
    quickCreateParent: selectedEpic ? { id: selectedEpic.id, key: selectedEpic.key, summary: selectedEpic.summary } : null,
  }

  const dialogIssueCount = dialog
    ? (containers.find((c) => c.sprint?.id === dialog.sprint.id)?.issues.length ?? dialog.sprint.issueCount)
    : 0

  let body
  if (backlog.isPending) {
    body = <BacklogSkeleton sections={flat ? 1 : 2} />
  } else if (backlog.isError) {
    body = (
      <div className="rounded-lg border border-border">
        <ErrorState error={backlog.error} title="Couldn’t load the backlog" onRetry={() => void backlog.refetch()} />
      </div>
    )
  } else {
    body = (
      <BacklogLists
        containers={containers}
        filters={effectiveFilters}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onDrop={handleDrop}
      />
    )
  }

  return (
    <BacklogActionsContext value={actions}>
      <div className="flex h-full min-h-0 flex-col" data-testid="backlog-page">
        <div className="shrink-0 px-6 pt-5">
          <PageHeader
            title="Backlog"
            breadcrumbs={[
              { label: 'Projects', to: '/projects' },
              { label: project.name, to: `/projects/${projectKey}` },
              { label: 'Backlog' },
            ]}
            actions={
              canEdit ? (
                <Button
                  icon={<Plus />}
                  onClick={() =>
                    openCreateIssue({
                      projectKey,
                      ...(!flat && { sprintId: null }),
                      ...(selectedEpic && { parentId: selectedEpic.id, parentKey: selectedEpic.key, parentType: 'epic' }),
                    })
                  }
                  data-testid="backlog-create-issue"
                >
                  Create issue
                </Button>
              ) : (
                <Badge tone="neutral" shape="square" size="md">
                  Read only
                </Badge>
              )
            }
          >
            <BacklogToolbar
              projectKey={projectKey}
              filters={effectiveFilters}
              onFiltersChange={(update) => setFilters((f) => update(staleEpic ? { ...f, epic: null } : f))}
              selectedEpic={selectedEpic}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen(!panelOpen)}
              visibleCount={counts.visible}
              totalCount={counts.total}
            />
          </PageHeader>
        </div>
        <div className="flex min-h-0 flex-1 border-t border-border">
          {panelOpen && (
            <EpicsPanel
              projectKey={projectKey}
              value={effectiveFilters.epic}
              onChange={(epic) => setFilters((f) => ({ ...f, epic }))}
              onClose={() => setPanelOpen(false)}
              canEdit={canEdit}
            />
          )}
          <div className="min-w-0 flex-1 overflow-y-auto px-6 pt-4 pb-12">
            {flat && <KanbanHint projectKey={projectKey} />}
            {flat && canEdit && backlog.data && backlog.data.sprints.length > 0 && (
              <LeftoverSprints
                sprints={backlog.data.sprints.map((s) => s.sprint)}
                onComplete={setCompleting}
                onDelete={(sprint) => confirmDeleteSprint(sprint, sprint.issueCount)}
              />
            )}
            {body}
          </div>
        </div>
      </div>
      {dialog?.type === 'start' && (
        <StartSprintDialog
          key={`start-${dialog.sprint.id}`}
          projectKey={projectKey}
          sprint={dialog.sprint}
          issueCount={dialogIssueCount}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'edit' && (
        <EditSprintDialog
          key={`edit-${dialog.sprint.id}`}
          projectKey={projectKey}
          sprint={dialog.sprint}
          issueCount={dialogIssueCount}
          onClose={() => setDialog(null)}
        />
      )}
      {completing && (
        <BacklogCompleteSprint
          key={completing.id}
          project={project}
          sprint={completing}
          sprintIssues={backlog.data?.sprints.find((s) => s.sprint.id === completing.id)?.issues ?? []}
          onClose={() => setCompleting(null)}
        />
      )}
    </BacklogActionsContext>
  )
}

/**
 * Complete sprint from the backlog (Jira completes in place, so the next sprint can be started
 * right away). The backlog lists only stories, tasks and bugs; the sprint's subtasks are
 * loaded too, so open subtasks of done issues are pointed out.
 */
function BacklogCompleteSprint({
  project,
  sprint,
  sprintIssues,
  onClose,
}: {
  project: Project
  sprint: Sprint
  sprintIssues: readonly Issue[]
  onClose: () => void
}) {
  const statuses = useStatuses(project.key)
  const subtasks = useIssues({ project: project.key, sprintId: sprint.id, type: 'subtask', limit: 200 })
  const issues = useMemo(() => [...sprintIssues, ...(subtasks.data?.items ?? [])], [sprintIssues, subtasks.data])
  return (
    <CompleteSprintDialog
      open
      onOpenChange={(open) => !open && onClose()}
      projectKey={project.key}
      sprint={sprint}
      issues={issues}
      statuses={statuses.data ?? []}
      allowNewSprint={project.type === 'scrum'}
    />
  )
}

/**
 * Kanban projects don't use sprints, but a project switched from Scrum can still have open
 * ones. They are listed here so they can be completed or deleted (the API allows both).
 */
function LeftoverSprints({
  sprints,
  onComplete,
  onDelete,
}: {
  sprints: readonly Sprint[]
  onComplete: (sprint: Sprint) => void
  onDelete: (sprint: Sprint) => void
}) {
  return (
    <section
      aria-label="Sprints from when this project used Scrum"
      className="mb-4 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3"
      data-testid="backlog-leftover-sprints"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <History className="size-4 shrink-0 text-warning" aria-hidden />
        {sprints.length === 1 ? 'A sprint' : `${sprints.length} sprints`} from when this project used Scrum{' '}
        {sprints.length === 1 ? 'is' : 'are'} still open
      </p>
      <p className="mt-0.5 text-sm text-fg-muted">
        Their issues are part of the list below. Complete or delete them to clear their sprint.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {sprints.map((sprint) => {
          const dates = formatDateRange(sprint.startDate, sprint.endDate)
          return (
            <li key={sprint.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-fg">{sprint.name}</span>
              <span className="text-xs text-fg-muted">
                {sprint.state === 'active' ? 'Active' : 'Planned'}
                {dates && ` · ${dates}`} · {pluralize(sprint.issueCount, 'issue')}
              </span>
              <span className="ml-auto flex gap-1.5">
                {sprint.state === 'active' ? (
                  <Button size="sm" icon={<CheckCheck />} onClick={() => onComplete(sprint)} data-testid={`leftover-complete-${sprint.id}`}>
                    Complete sprint
                  </Button>
                ) : (
                  <Button size="sm" icon={<Trash2 />} onClick={() => onDelete(sprint)} data-testid={`leftover-delete-${sprint.id}`}>
                    Delete sprint
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Kanban projects have no sprints: explain the flat list and point to the board. */
function KanbanHint({ projectKey }: { projectKey: string }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info-subtle px-4 py-3"
      data-testid="backlog-kanban-hint"
    >
      <Info className="size-4 shrink-0 text-info" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-fg">
        Kanban projects don’t use sprints. This is the full ranked list of work: drag issues to change their order,
        and use the board to move them through your workflow.
      </p>
      <Link to={`/projects/${projectKey}/board`} className={buttonClasses({ size: 'sm' })}>
        Open board
      </Link>
    </div>
  )
}

function BacklogSkeleton({ sections }: { sections: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading backlog">
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="rounded-lg bg-surface-sunken p-2" aria-hidden>
          <div className="flex h-8 items-center gap-2 px-1">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
            <div className="ml-auto flex gap-1">
              <Skeleton className="h-5 w-6 rounded-full" />
              <Skeleton className="h-5 w-6 rounded-full" />
              <Skeleton className="h-5 w-6 rounded-full" />
            </div>
          </div>
          <SkeletonRows
            rows={i === 0 ? 3 : 5}
            className="mt-1.5 overflow-hidden rounded-md border border-border bg-surface"
          />
        </div>
      ))}
    </div>
  )
}
