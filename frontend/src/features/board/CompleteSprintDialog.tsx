import { CircleCheck, CircleDashed, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useCompleteSprint, useSprints } from '@/api/sprints'
import type { CompleteSprintInput, Issue, Sprint, SprintState, Status } from '@/api/types'
import { IssueKeyLink } from '@/components/issue/IssueKeyLink'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { toast, toastError } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { formatDateRange } from '@/lib/dates'
import { pluralize } from '@/lib/format'
import { formatPoints, isDone } from '@/lib/issueMeta'

const PLANNED: readonly SprintState[] = ['planned']

/** Select value: the backlog, a new sprint, or `sprint:<id>` for an existing planned sprint. */
type TargetValue = 'backlog' | 'new' | `sprint:${number}`

interface SprintStats {
  done: number
  open: number
  pointsDone: number
  pointsTotal: number
}

/** Done vs open counts over the sprint's parent issues (subtasks follow their parent). */
function computeStats(issues: readonly Issue[]): SprintStats {
  const stats: SprintStats = { done: 0, open: 0, pointsDone: 0, pointsTotal: 0 }
  for (const issue of issues) {
    if (issue.type === 'subtask' || issue.type === 'epic') continue
    const points = issue.storyPoints ?? 0
    stats.pointsTotal += points
    if (isDone(issue)) {
      stats.done += 1
      stats.pointsDone += points
    } else {
      stats.open += 1
    }
  }
  return stats
}

/**
 * Open subtasks whose parent is done. Only open parents move out of a completed sprint (and
 * take their subtasks along), so these stay behind in the completed sprint, where neither the
 * board nor the backlog shows them.
 */
function strandedSubtasks(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => i.type === 'subtask' && !isDone(i) && i.parent?.status.category === 'done')
}

function toInput(target: TargetValue): CompleteSprintInput {
  if (target === 'backlog' || target === 'new') return { target }
  return { target: 'sprint', sprintId: Number(target.slice('sprint:'.length)) }
}

/** Props of `CompleteSprintDialog`. */
export interface CompleteSprintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectKey: string
  sprint: Sprint
  /** The sprint's issues (the board's issues; subtasks are needed to spot stranded ones). */
  issues: readonly Issue[]
  statuses: readonly Status[]
  /** Offer "New sprint" as the target (not for sprints left over in a Kanban project). */
  allowNewSprint?: boolean
}

/**
 * Jira's "Complete sprint" dialog: completed vs open issue counts and where the open issues go
 * (backlog, an existing planned sprint, or a new sprint). Toasts the outcome and closes; the
 * board then refetches and shows its "no active sprint" state.
 */
export function CompleteSprintDialog({
  open,
  onOpenChange,
  projectKey,
  sprint,
  issues,
  statuses,
  allowNewSprint = true,
}: CompleteSprintDialogProps) {
  const complete = useCompleteSprint(projectKey)
  const planned = useSprints(projectKey, PLANNED, { enabled: open })
  const plannedSprints = (planned.data ?? []).filter((s) => s.state === 'planned' && s.id !== sprint.id)

  // Frozen on submit, so the numbers don't drop to zero while the board refetches.
  const [frozen, setFrozen] = useState<{ stats: SprintStats; stranded: Issue[] } | null>(null)
  const stats = frozen?.stats ?? computeStats(issues)
  const stranded = frozen?.stranded ?? strandedSubtasks(issues)

  const [choice, setChoice] = useState<TargetValue | null>(null)
  const defaultTarget: TargetValue = plannedSprints[0] ? `sprint:${plannedSprints[0].id}` : 'backlog'
  const target = choice ?? defaultTarget
  const targetSprint = target.startsWith('sprint:') ? plannedSprints.find((s) => `sprint:${s.id}` === target) : undefined

  const doneColumns = statuses.filter((s) => s.category === 'done').map((s) => s.name)
  const hasOpen = stats.open > 0
  const waitingForSprints = hasOpen && planned.isPending

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (complete.isPending || waitingForSprints) return
    setFrozen({ stats, stranded })
    try {
      const result = await complete.mutateAsync({ id: sprint.id, ...toInput(hasOpen ? target : 'backlog') })
      const completed = pluralize(result.completedIssueCount, 'issue')
      const destination = result.targetSprint?.name ?? 'the backlog'
      toast.success(`${result.sprint.name} completed`, {
        description:
          result.movedIssueCount > 0
            ? `${completed} done · ${pluralize(result.movedIssueCount, 'open issue')} moved to ${destination}`
            : `${completed} done`,
      })
      onOpenChange(false)
    } catch (error) {
      setFrozen(null)
      toastError(error, 'Couldn’t complete the sprint')
    }
  }

  const options = [
    { value: 'backlog', label: 'Backlog' },
    ...plannedSprints.map((s) => ({ value: `sprint:${s.id}`, label: s.name })),
    ...(allowNewSprint ? [{ value: 'new', label: 'New sprint' }] : []),
  ]

  const targetHint =
    target === 'new'
      ? 'A new planned sprint is created for the open issues.'
      : targetSprint
        ? `Open issues and their subtasks move to ${targetSprint.name}.`
        : 'Open issues and their subtasks move to the backlog.'

  const dates = formatDateRange(sprint.startDate, sprint.endDate)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Complete ${sprint.name}`}
      description={dates || undefined}
      size="md"
      onSubmit={onSubmit}
      preventClose={complete.isPending}
      data-testid="complete-sprint-dialog"
      footer={
        <>
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={complete.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={complete.isPending}
            disabled={waitingForSprints}
            data-autofocus={hasOpen ? undefined : true}
            data-testid="complete-sprint-submit"
          >
            Complete sprint
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            icon={<CircleCheck className="text-success" />}
            label="Completed issues"
            value={stats.done}
            detail={`${formatPoints(stats.pointsDone)} of ${formatPoints(stats.pointsTotal)} points`}
            tone="success"
          />
          <StatTile
            icon={<CircleDashed className="text-info" />}
            label="Open issues"
            value={stats.open}
            detail={`${formatPoints(stats.pointsTotal - stats.pointsDone)} points`}
            tone="info"
          />
        </div>
        <p className="text-sm text-fg-muted">
          This sprint contains{' '}
          <strong className="font-semibold text-fg">{pluralize(stats.done, 'completed issue')}</strong> and{' '}
          <strong className="font-semibold text-fg">{pluralize(stats.open, 'open issue')}</strong>.{' '}
          {doneColumns.length > 0 &&
            `Completed issues are those in the ${doneColumns.join(', ')} ${doneColumns.length === 1 ? 'column' : 'columns'}; open issues are in any other column.`}
        </p>
        {hasOpen ? (
          <Field
            label="Move open issues to"
            hint={planned.isError ? 'Couldn’t load planned sprints — you can still use the backlog or a new sprint.' : targetHint}
          >
            <Select
              value={target}
              onChange={(e) => setChoice(e.target.value as TargetValue)}
              options={options}
              disabled={complete.isPending || waitingForSprints}
              data-autofocus
              data-testid="complete-sprint-target"
            />
          </Field>
        ) : stranded.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md bg-success-subtle px-3 py-2 text-sm text-success">
            <CircleCheck className="size-4 shrink-0" aria-hidden />
            Every issue in this sprint is done. Nice work!
          </p>
        ) : null}
        {stranded.length > 0 && <StrandedSubtasks subtasks={stranded} />}
      </div>
    </Dialog>
  )
}

function StatTile({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number
  detail: string
  tone: 'success' | 'info'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5',
        tone === 'success' ? 'bg-success-subtle/40' : 'bg-info-subtle/40',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="text-2xl leading-8 font-semibold text-fg tabular-nums">{value}</span>
      <span className="text-xs text-fg-subtle">{detail}</span>
    </div>
  )
}

/** Warning listing open subtasks of done issues, which stay in the completed sprint. */
function StrandedSubtasks({ subtasks }: { subtasks: readonly Issue[] }) {
  const shown = subtasks.slice(0, 5)
  return (
    <div
      className="flex gap-2.5 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2.5 text-sm"
      data-testid="complete-sprint-stranded"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">
          {subtasks.length === 1
            ? '1 open subtask stays in this sprint'
            : `${subtasks.length} open subtasks stay in this sprint`}
        </p>
        <p className="mt-0.5 text-fg-muted">
          Their parent issues are done, and subtasks always stay with their parent. Once the sprint is completed they
          won’t appear on the board or in the backlog — finish them, or reopen their parent to carry them over.
        </p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {shown.map((subtask) => (
            <li key={subtask.id} className="flex min-w-0 items-baseline gap-2">
              <IssueKeyLink issueKey={subtask.key} />
              <span className="truncate text-fg">{subtask.summary}</span>
              {subtask.parent && <span className="shrink-0 text-xs text-fg-subtle">in {subtask.parent.key}</span>}
            </li>
          ))}
        </ul>
        {subtasks.length > shown.length && (
          <p className="mt-1 text-xs text-fg-subtle">and {subtasks.length - shown.length} more</p>
        )}
      </div>
    </div>
  )
}
