import { Inbox, SearchX } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useBoard } from '@/api/board'
import type { ID, Project } from '@/api/types'
import { useCreateIssueModal, useIssueModal } from '@/app/ModalsProvider'
import { useCurrentUser } from '@/auth/AuthProvider'
import { useCurrentProject } from '@/components/layout/ProjectLayout'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { useDocumentTitle } from '@/lib/hooks'
import { useProjectRole } from '@/lib/useProjectRole'
import { BoardCanvas } from './BoardCanvas'
import { useBoardFilters } from './boardFilters'
import { BoardHeader } from './BoardHeader'
import { BoardNotice, BoardSkeleton, NoActiveSprint } from './BoardStates'
import { BoardToolbar } from './BoardToolbar'
import { CompleteSprintDialog } from './CompleteSprintDialog'
import { useBoardView } from './useBoardView'
import { useOptimisticBoard } from './useOptimisticBoard'

/** `?completeSprint=1` (linked from the backlog) opens the Complete sprint dialog. */
const COMPLETE_SPRINT_PARAM = 'completeSprint'

/**
 * Project board (`/projects/:projectKey/board`): the active sprint (Scrum) or the continuous
 * flow (Kanban) as status columns with drag and drop, quick filters and sprint completion.
 */
export function BoardPage() {
  const project = useCurrentProject()
  // Keyed by project so filters and drag state never leak between projects.
  return <ProjectBoard key={project.key} project={project} />
}

function ProjectBoard({ project }: { project: Project }) {
  const projectKey = project.key
  const me = useCurrentUser()
  const { canEdit, isLoading: roleLoading } = useProjectRole(projectKey)
  const { openIssue } = useIssueModal()
  const { openCreateIssue } = useCreateIssueModal()

  const query = useBoard(projectKey)
  const { board, moveIssue } = useOptimisticBoard(projectKey, query.data)
  const { filters, update: updateFilters, clear: clearFilters } = useBoardFilters()
  const view = useBoardView(board, filters, me.id)

  const type = board?.project.type ?? project.type
  const sprint = type === 'scrum' ? (board?.sprint ?? null) : null
  useDocumentTitle(sprint?.name ?? `${projectKey} board`)

  // The dialog is bound to one sprint id, so it can never pop up for a sprint started later.
  const [completeSprintId, setCompleteSprintId] = useState<ID | null>(null)
  const openCompleteSprint = useCallback(() => {
    if (sprint) setCompleteSprintId(sprint.id)
  }, [sprint])

  // `?completeSprint=1` (the backlog links here) opens the dialog; the param is dropped when the
  // dialog closes — or right away when there is nothing this user can complete.
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const completeRequested = searchParams.has(COMPLETE_SPRINT_PARAM)
  const canComplete = !!sprint && canEdit
  const dialogOpen = !!sprint && (completeSprintId === sprint.id || (completeRequested && canComplete))

  const locationState = location.state as unknown
  const dropCompleteParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(COMPLETE_SPRINT_PARAM)
        return next
      },
      { replace: true, state: locationState },
    )
  }, [setSearchParams, locationState])

  const boardSettled = !!board || query.isError
  useEffect(() => {
    if (!completeRequested || !boardSettled || roleLoading || canComplete) return
    if (sprint) toast.error('Only project members can complete a sprint.')
    dropCompleteParam()
  }, [completeRequested, boardSettled, roleLoading, canComplete, sprint, dropCompleteParam])

  const closeCompleteSprint = () => {
    setCompleteSprintId(null)
    if (completeRequested) dropCompleteParam()
  }

  const header = (toolbar?: ReactNode) => (
    <BoardHeader
      project={project}
      type={type}
      sprint={sprint}
      loading={!board}
      canEdit={canEdit}
      onCompleteSprint={openCompleteSprint}
    >
      {toolbar}
    </BoardHeader>
  )

  if (!board || !view) {
    return (
      <div className="flex h-full flex-col px-6 pt-5 pb-4">
        {header()}
        <div className="min-h-0 flex-1">
          {query.isError ? (
            <ErrorState error={query.error} title="Couldn’t load the board" onRetry={() => void query.refetch()} />
          ) : (
            <BoardSkeleton />
          )}
        </div>
      </div>
    )
  }

  if (type === 'scrum' && !sprint) {
    return (
      <div className="flex h-full flex-col px-6 pt-5 pb-4">
        {header()}
        <div className="min-h-0 flex-1">
          <NoActiveSprint projectKey={projectKey} canEdit={canEdit} />
        </div>
      </div>
    )
  }

  const firstStatus = board.statuses[0]
  const createIssue =
    canEdit && firstStatus
      ? () => openCreateIssue({ projectKey, statusId: firstStatus.id, ...(sprint ? { sprintId: sprint.id } : {}) })
      : undefined

  let notice: ReactNode = null
  if (view.totalCount === 0) {
    notice =
      type === 'scrum' ? (
        <BoardNotice
          icon={<Inbox />}
          action={
            <Link to={`/projects/${projectKey}/backlog`} className="text-sm font-medium text-primary hover:underline">
              Plan in the backlog
            </Link>
          }
        >
          This sprint has no issues yet.
        </BoardNotice>
      ) : (
        <BoardNotice
          icon={<Inbox />}
          action={
            createIssue && (
              <Button size="sm" variant="link" onClick={createIssue}>
                Create an issue
              </Button>
            )
          }
        >
          No issues on the board yet.
        </BoardNotice>
      )
  } else if (view.filtered && view.shownCount === 0) {
    notice = (
      <BoardNotice
        icon={<SearchX />}
        action={
          <Button size="sm" variant="link" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      >
        No issues match your filters.
      </BoardNotice>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 px-6 pt-5">
        {header(
          <BoardToolbar
            filters={filters}
            options={view.options}
            onChange={updateFilters}
            onClear={clearFilters}
            active={view.filtered}
            shownCount={view.shownCount}
            totalCount={view.totalCount}
          />,
        )}
        {notice}
      </div>
      <div className="min-h-80 flex-1 px-6 pb-4">
        <BoardCanvas
          statuses={board.statuses}
          columns={view.columns}
          visibleColumns={view.visibleColumns}
          filtered={view.filtered}
          canEdit={canEdit}
          epics={view.epics}
          onOpenIssue={openIssue}
          onMoveIssue={moveIssue}
          onCreateIssue={createIssue}
        />
      </div>
      {sprint && dialogOpen && (
        <CompleteSprintDialog
          open
          onOpenChange={(open) => !open && closeCompleteSprint()}
          projectKey={projectKey}
          sprint={sprint}
          issues={board.issues}
          statuses={board.statuses}
        />
      )}
    </div>
  )
}
