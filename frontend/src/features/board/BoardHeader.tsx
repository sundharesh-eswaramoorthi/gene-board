import { CalendarDays, Clock, Eye, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Project, ProjectType, Sprint } from '@/api/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tooltip } from '@/components/ui/Tooltip'
import { daysRemaining, formatDateRange, formatDaysRemaining } from '@/lib/dates'

/** Props of `BoardHeader`. */
export interface BoardHeaderProps {
  project: Project
  type: ProjectType
  /** The active sprint (Scrum). */
  sprint: Sprint | null
  /** Board data is still loading (title placeholder). */
  loading?: boolean
  canEdit: boolean
  /** Opens the Complete sprint dialog (Scrum, members only). */
  onCompleteSprint?: () => void
  /** Toolbar row (filters). */
  children?: ReactNode
}

function remainingTone(days: number): BadgeTone {
  if (days < 0) return 'danger'
  if (days <= 1) return 'warning'
  return 'neutral'
}

/**
 * Board title block. Scrum: the active sprint's name, goal, dates, days remaining and
 * "Complete sprint". Kanban: the board name and its retention rule for done issues.
 */
export function BoardHeader({ project, type, sprint, loading = false, canEdit, onCompleteSprint, children }: BoardHeaderProps) {
  const title = loading ? <Skeleton className="my-1 h-6 w-48" /> : (sprint?.name ?? `${project.key} board`)
  const days = sprint ? daysRemaining(sprint.endDate) : null
  const dates = sprint ? formatDateRange(sprint.startDate, sprint.endDate) : ''

  let description: ReactNode = null
  if (sprint && (dates || sprint.goal)) {
    description = (
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {dates && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <span className="sr-only">Sprint dates: </span>
            {dates}
          </span>
        )}
        {sprint.goal && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Target className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <span className="sr-only">Sprint goal: </span>
            <span className="line-clamp-2">{sprint.goal}</span>
          </span>
        )}
      </span>
    )
  } else if (type === 'kanban' && !loading) {
    description = 'Done issues leave the board 14 days after they’re resolved.'
  }

  const actions = (
    <>
      {!canEdit && !loading && (
        <Tooltip content="You have view-only access to this project">
          <Badge tone="neutral" size="md" shape="square">
            <Eye className="size-3.5" aria-hidden />
            Read only
          </Badge>
        </Tooltip>
      )}
      {sprint && days != null && (
        <Badge tone={remainingTone(days)} size="md" shape="square" data-testid="sprint-days-remaining">
          <Clock className="size-3.5" aria-hidden />
          {formatDaysRemaining(sprint.endDate)}
        </Badge>
      )}
      {sprint && canEdit && onCompleteSprint && (
        <Button onClick={onCompleteSprint} data-testid="complete-sprint-button">
          Complete sprint
        </Button>
      )}
    </>
  )

  return (
    <PageHeader
      breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: project.name }]}
      title={title}
      description={description}
      actions={actions}
      className="pb-3"
    >
      {children}
    </PageHeader>
  )
}
