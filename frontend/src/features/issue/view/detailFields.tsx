import { useCallback, useId, type ReactNode } from 'react'
import type { ID, IssueDetail, IssueSprintRef, IssueType, Label, Priority, Status, UserSummary } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import {
  DueDateLabel,
  LabelMultiSelect,
  ParentPicker,
  PrioritySelect,
  SprintSelect,
  StatusSelect,
  TypeSelect,
  UserPicker,
  type IssuePickerValue,
} from '@/components/issue'
import { Spinner } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { allowedTypeChanges, formatPoints, ISSUE_TYPE_META, PRIORITY_META } from '@/lib/issueMeta'
import { useOptimisticField, type SaveIssue } from '../shared/useIssueSave'
import { InlineEditInput } from './InlineEditInput'
import { useIssueView } from './IssueViewContext'

/** Props shared by every field editor of the details panel. */
export interface IssueFieldProps {
  issue: IssueDetail
  save: SaveIssue
}

/**
 * While a field saves its picker stays focusable (so keyboard focus isn't lost) but can't be
 * reopened: pass this as the picker's controlled `open`.
 */
function lockedOpen(isPending: boolean): false | undefined {
  return isPending ? false : undefined
}

/** One label/value row of the details `<dl>`, with a spinner while the value saves. */
export function DetailRow({
  label,
  htmlFor,
  saving = false,
  children,
}: {
  label: string
  htmlFor?: string
  saving?: boolean
  children: ReactNode
}) {
  return (
    <>
      <dt className="flex min-h-8 items-center gap-1.5 text-xs font-semibold text-fg-muted">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {saving && <Spinner size="xs" label={`Saving ${label.toLowerCase()}`} className="text-fg-subtle" />}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

/** Prominent, category-coloured status button (top of the details panel). */
export function StatusField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const persist = useCallback((status: Pick<Status, 'id'>) => save({ statusId: status.id }), [save])
  const { value, commit, isPending } = useOptimisticField<Pick<Status, 'id' | 'name' | 'category'>>(issue.status, persist)
  return (
    <div className="flex items-center gap-2">
      <StatusSelect
        variant="button"
        data-testid="issue-status"
        projectKey={issue.projectKey}
        value={value}
        disabled={!canEdit}
        open={lockedOpen(isPending)}
        aria-label={`Status: ${value.name}${canEdit ? '. Change status' : ''}`}
        onChange={(_id, status) => commit(status)}
      />
      {isPending && <Spinner size="xs" label="Saving status" className="text-fg-subtle" />}
    </div>
  )
}

/** Issue type control for the breadcrumb: a compact picker among story/task/bug. */
export function TypeField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const persist = useCallback((type: IssueType) => save({ type }), [save])
  const { value, commit, isPending } = useOptimisticField<IssueType>(issue.type, persist)
  const types = allowedTypeChanges(issue.type)
  return (
    <TypeSelect
      variant="compact"
      value={value}
      types={types}
      disabled={!canEdit || types.length < 2}
      open={lockedOpen(isPending)}
      aria-label={`Issue type: ${ISSUE_TYPE_META[value].label}${canEdit && types.length > 1 ? '. Change type' : ''}`}
      className="h-6 px-0.5"
      onChange={commit}
    />
  )
}

function useSelfSummary(): UserSummary | null {
  const { user } = useAuth()
  return user ? { id: user.id, name: user.name, email: user.email } : null
}

/** Resolve a picker's `(id, user)` pair into a UserSummary for optimistic display. */
function pickedUser(userId: ID | null, user: UserSummary | null): UserSummary | null {
  if (userId == null) return null
  return user ?? { id: userId, name: 'Unknown user', email: '' }
}

/** Assignee picker plus the "Assign to me" shortcut. */
export function AssigneeField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const me = useSelfSummary()
  const id = useId()
  const persist = useCallback((user: UserSummary | null) => save({ assigneeId: user?.id ?? null }), [save])
  const { value, commit, isPending } = useOptimisticField<UserSummary | null>(issue.assignee, persist)
  return (
    <DetailRow label="Assignee" htmlFor={id} saving={isPending}>
      <UserPicker
        id={id}
        variant="inline"
        projectKey={issue.projectKey}
        value={value}
        disabled={!canEdit}
        open={lockedOpen(isPending)}
        aria-label={`Assignee: ${value?.name ?? 'Unassigned'}`}
        onChange={(userId, user) => commit(pickedUser(userId, user))}
      />
      {canEdit && me && value?.id !== me.id && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => commit(me)}
          className="mt-0.5 rounded-sm text-xs font-medium text-primary hover:underline disabled:opacity-50"
        >
          Assign to me
        </button>
      )}
    </DetailRow>
  )
}

/** Reporter picker (a reporter can be changed but not removed). */
export function ReporterField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const id = useId()
  const persist = useCallback((user: UserSummary | null) => save({ reporterId: user?.id ?? null }), [save])
  const { value, commit, isPending } = useOptimisticField<UserSummary | null>(issue.reporter, persist)
  return (
    <DetailRow label="Reporter" htmlFor={id} saving={isPending}>
      <UserPicker
        id={id}
        variant="inline"
        projectKey={issue.projectKey}
        value={value}
        allowUnassigned={false}
        unassignedLabel="None"
        disabled={!canEdit}
        open={lockedOpen(isPending)}
        aria-label={`Reporter: ${value?.name ?? 'None'}`}
        onChange={(userId, user) => commit(pickedUser(userId, user))}
      />
    </DetailRow>
  )
}

/** Priority picker. */
export function PriorityField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const id = useId()
  const persist = useCallback((priority: Priority) => save({ priority }), [save])
  const { value, commit, isPending } = useOptimisticField<Priority>(issue.priority, persist)
  return (
    <DetailRow label="Priority" htmlFor={id} saving={isPending}>
      <PrioritySelect
        id={id}
        variant="inline"
        value={value}
        disabled={!canEdit}
        open={lockedOpen(isPending)}
        aria-label={`Priority: ${PRIORITY_META[value].label}`}
        onChange={commit}
      />
    </DetailRow>
  )
}

/** Labels (multi-select, can create labels); one PATCH when the picker closes. */
export function LabelsField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const id = useId()
  const persist = useCallback(
    (labels: readonly Label[] | readonly ID[]) =>
      save({ labelIds: labels.map((l) => (typeof l === 'number' ? l : l.id)) }),
    [save],
  )
  const { value, commit, isPending } = useOptimisticField<readonly Label[] | readonly ID[]>(issue.labels, persist)
  return (
    <DetailRow label="Labels" htmlFor={id} saving={isPending}>
      <LabelMultiSelect
        id={id}
        variant="inline"
        commitMode="onClose"
        projectKey={issue.projectKey}
        value={value}
        disabled={!canEdit}
        open={lockedOpen(isPending)}
        onChange={(ids, labels) => commit(labels.length === ids.length ? labels : ids)}
      />
    </DetailRow>
  )
}

/** Sprint picker (standard issues of Scrum projects). */
export function SprintField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const id = useId()
  const persist = useCallback((sprint: IssueSprintRef | null) => save({ sprintId: sprint?.id ?? null }), [save])
  const { value, commit, isPending } = useOptimisticField<IssueSprintRef | null>(issue.sprint, persist)
  return (
    <DetailRow label="Sprint" htmlFor={id} saving={isPending}>
      <SprintSelect
        id={id}
        variant="inline"
        projectKey={issue.projectKey}
        value={value}
        backlogLabel="None"
        disabled={!canEdit}
        open={lockedOpen(isPending)}
        aria-label={`Sprint: ${value?.name ?? 'None (backlog)'}`}
        onChange={(sprintId, sprint) => {
          if (sprintId == null) commit(null)
          else if (sprint) commit({ id: sprint.id, name: sprint.name, state: sprint.state })
        }}
      />
    </DetailRow>
  )
}

/**
 * Epic (for stories/tasks/bugs) or parent (for subtasks). A subtask's parent is required: it
 * can be changed but not cleared.
 */
export function ParentField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const id = useId()
  const persist = useCallback((parent: IssuePickerValue | null) => save({ parentId: parent?.id ?? null }), [save])
  const { value, commit, isPending } = useOptimisticField<IssuePickerValue | null>(issue.parent, persist)
  const label = issue.type === 'subtask' ? 'Parent' : 'Epic'
  return (
    <DetailRow label={label} htmlFor={id} saving={isPending}>
      <ParentPicker
        id={id}
        variant="inline"
        projectKey={issue.projectKey}
        childType={issue.type}
        value={value}
        excludeIds={[issue.id]}
        placeholder="None"
        disabled={!canEdit}
        open={lockedOpen(isPending)}
        aria-label={`${label}: ${value ? `${value.key} ${value.summary}` : 'None'}`}
        onChange={(parent) => commit(parent)}
      />
    </DetailRow>
  )
}

const POINTS_ERROR = 'Story points must be a number from 0 to 1000'

function validatePoints(raw: string): string | null {
  if (raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? null : POINTS_ERROR
}

/** Story point estimate: click to edit; Enter/blur saves, empty clears. */
export function StoryPointsField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const id = useId()
  const persist = useCallback((points: number | null) => save({ storyPoints: points }), [save])
  const { value, commit, isPending } = useOptimisticField<number | null>(issue.storyPoints, persist)
  const text = formatPoints(value, '')
  return (
    <DetailRow label="Story points" htmlFor={id} saving={isPending}>
      <InlineEditInput
        id={id}
        type="number"
        label="Story points"
        value={value == null ? '' : String(value)}
        display={<span className="tabular-nums">{text}</span>}
        displayText={text}
        readOnly={!canEdit}
        busy={isPending}
        validate={validatePoints}
        badInputMessage={POINTS_ERROR}
        onCommit={(raw) => commit(raw === '' ? null : Number(raw))}
        inputProps={{ min: 0, max: 1000, step: 'any', inputMode: 'decimal' }}
      />
    </DetailRow>
  )
}

function validateDate(raw: string): string | null {
  return raw === '' || /^\d{4}-\d{2}-\d{2}$/.test(raw) ? null : 'Enter a valid date'
}

/** Due date: click to pick; Enter/blur saves; the clear button (or an empty input) removes it. */
export function DueDateField({ issue, save }: IssueFieldProps) {
  const { canEdit } = useIssueView()
  const id = useId()
  const persist = useCallback((dueDate: string | null) => save({ dueDate }), [save])
  const { value, commit, isPending } = useOptimisticField<string | null>(issue.dueDate, persist)
  return (
    <DetailRow label="Due date" htmlFor={id} saving={isPending}>
      <InlineEditInput
        id={id}
        type="date"
        label="Due date"
        value={value ?? ''}
        display={<DueDateLabel date={value} resolved={issue.resolvedAt != null} format="long" />}
        displayText={formatDate(value)}
        readOnly={!canEdit}
        busy={isPending}
        clearable
        validate={validateDate}
        onCommit={(raw) => commit(raw === '' ? null : raw)}
      />
    </DetailRow>
  )
}
