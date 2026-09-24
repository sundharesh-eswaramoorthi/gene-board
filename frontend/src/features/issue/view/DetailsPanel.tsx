import { X } from 'lucide-react'
import { useCallback, useId } from 'react'
import type { IssueDetail, IssueSprintRef, Project } from '@/api/types'
import { IconButton, Tooltip } from '@/components/ui'
import { formatDateTime, formatRelative } from '@/lib/dates'
import { useOptimisticField, type SaveIssue } from '../shared/useIssueSave'
import { isDone } from '@/lib/issueMeta'
import {
  AssigneeField,
  DetailRow,
  DueDateField,
  LabelsField,
  ParentField,
  PriorityField,
  ReporterField,
  SprintField,
  StatusField,
  StoryPointsField,
} from './detailFields'
import { useIssueView } from './IssueViewContext'

/** Props of `DetailsPanel`. */
export interface DetailsPanelProps {
  issue: IssueDetail
  /** The issue's project (undefined while loading): decides whether sprints apply. */
  project: Project | undefined
  save: SaveIssue
}

/**
 * Which sprint field a standard issue gets: the picker in Scrum projects; in Kanban projects
 * only the sprint it may still be in from before the switch, so it can be taken out of it
 * (Kanban issues can't join a sprint: the API refuses one).
 */
function sprintFieldKind(issue: IssueDetail, project: Project | undefined): 'picker' | 'leftover' | null {
  if (issue.type === 'epic' || issue.type === 'subtask') return null
  if (project?.type === 'kanban') return issue.sprint != null ? 'leftover' : null
  return project?.type === 'scrum' || issue.sprint != null ? 'picker' : null
}

/** A Kanban issue's leftover sprint, read-only with a button that removes the issue from it. */
function LeftoverSprintField({ issue, save }: { issue: IssueDetail; save: SaveIssue }) {
  const { canEdit } = useIssueView()
  const persist = useCallback(() => save({ sprintId: null }), [save])
  const { value, commit, isPending } = useOptimisticField<IssueSprintRef | null>(issue.sprint, persist)
  return (
    <DetailRow label="Sprint" saving={isPending}>
      <span className="flex min-h-8 min-w-0 items-center gap-1 text-sm text-fg" data-testid="issue-leftover-sprint">
        <span className="truncate">{value?.name ?? 'None'}</span>
        {value && canEdit && (
          <IconButton
            size="xs"
            label={`Remove from ${value.name}`}
            icon={<X />}
            disabled={isPending}
            onClick={() => commit(null)}
          />
        )}
      </span>
    </DetailRow>
  )
}

/**
 * A subtask shares its parent's sprint, so it has no sprint field. When it is still open in a
 * completed sprint (its parent was done when the sprint closed) that sprint is shown read-only:
 * such subtasks appear on no board or backlog, and this says where they are.
 */
function StrandedSprint({ issue }: { issue: IssueDetail }) {
  if (issue.type !== 'subtask' || issue.sprint?.state !== 'completed' || isDone(issue)) return null
  return (
    <DetailRow label="Sprint">
      <span className="flex min-h-8 items-center text-sm text-fg" data-testid="issue-stranded-sprint">
        {issue.sprint.name}
        <span className="ml-1.5 text-xs text-fg-subtle">(completed, with the parent)</span>
      </span>
    </DetailRow>
  )
}

function Timestamp({ label, value, relative = false }: { label: string; value: string; relative?: boolean }) {
  return (
    <p>
      {label}{' '}
      <Tooltip content={formatDateTime(value)}>
        <time dateTime={value} tabIndex={-1} className="text-fg-muted">
          {relative ? formatRelative(value) : formatDateTime(value)}
        </time>
      </Tooltip>
    </p>
  )
}

/**
 * Right-hand panel of the issue view: status button, the "Details" fields (each edit PATCHes
 * only that field, optimistically) and the created / updated / resolved timestamps.
 */
export function DetailsPanel({ issue, project, save }: DetailsPanelProps) {
  const fieldProps = { issue, save }
  const headingId = useId()
  return (
    <div className="flex flex-col gap-4">
      <StatusField {...fieldProps} />
      <section aria-labelledby={headingId} className="rounded-lg border border-border">
        <h3 id={headingId} className="border-b border-border px-4 py-2.5 text-sm font-semibold text-fg">
          Details
        </h3>
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-4 py-3">
          <AssigneeField {...fieldProps} />
          <ReporterField {...fieldProps} />
          <PriorityField {...fieldProps} />
          <LabelsField {...fieldProps} />
          {sprintFieldKind(issue, project) === 'picker' && <SprintField {...fieldProps} />}
          {sprintFieldKind(issue, project) === 'leftover' && <LeftoverSprintField {...fieldProps} />}
          <StrandedSprint issue={issue} />
          {issue.type !== 'epic' && <ParentField {...fieldProps} />}
          <StoryPointsField {...fieldProps} />
          <DueDateField {...fieldProps} />
        </dl>
      </section>
      <div className="flex flex-col gap-0.5 px-1 text-xs text-fg-subtle">
        <Timestamp label="Created" value={issue.createdAt} />
        <Timestamp label="Updated" value={issue.updatedAt} relative />
        {issue.resolvedAt && <Timestamp label="Resolved" value={issue.resolvedAt} />}
      </div>
    </div>
  )
}
