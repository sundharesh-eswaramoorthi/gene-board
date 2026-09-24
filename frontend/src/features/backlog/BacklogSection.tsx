import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronRight } from 'lucide-react'
import { useId, useMemo } from 'react'
import type { Issue, Sprint } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatDateRange, formatDaysRemaining, daysRemaining } from '@/lib/dates'
import { pluralize } from '@/lib/format'
import { SPRINT_STATE_META } from '@/lib/issueMeta'
import { useBacklogActions } from './BacklogContext'
import { SortableBacklogRow } from './BacklogRow'
import { containerName, containerSprintId, pointsByCategory, type BacklogContainer } from './model'
import { PointsSummary } from './PointsSummary'
import { QuickCreate } from './QuickCreate'
import { CreateSprintButton, SprintActions } from './SectionActions'
import { sectionDroppableId, type SectionDroppableData } from './useBacklogDnd'

/** Props of `BacklogSection`. */
export interface BacklogSectionProps {
  container: BacklogContainer
  /** Visible rows in display order (the live drag arrangement while dragging). */
  issues: Issue[]
  /** Filters are hiding some issues. */
  filtering: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  /** A dragged issue is currently over this section (and came from another one). */
  isDropTarget: boolean
}

/**
 * One stacked backlog section (active sprint, planned sprint, Backlog, or Kanban's flat list):
 * collapsible header with dates, counts, point pills and actions; sortable rows; quick create.
 * The whole section is a drop target, so empty and collapsed sections accept issues.
 */
export function BacklogSection({
  container,
  issues,
  filtering,
  collapsed,
  onToggleCollapsed,
  isDropTarget,
}: BacklogSectionProps) {
  const actions = useBacklogActions()
  const droppableData: SectionDroppableData = { keyboardTarget: collapsed || issues.length === 0 }
  const { setNodeRef } = useDroppable({
    id: sectionDroppableId(container.id),
    disabled: !actions.canEdit,
    data: droppableData,
  })
  const headingId = useId()
  const bodyId = useId()
  const points = useMemo(() => pointsByCategory(container.issues), [container.issues])
  const ids = useMemo(() => issues.map((i) => i.key), [issues])
  const { sprint } = container
  const testId = container.kind === 'sprint' && sprint ? `backlog-section-${sprint.id}` : 'backlog-section-backlog'

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn(
        'rounded-lg bg-surface-sunken p-2 transition-shadow',
        isDropTarget && 'ring-2 ring-primary/60',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <h2 id={headingId} className="min-w-0">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls={collapsed ? undefined : bodyId}
              className="flex min-w-0 items-center gap-1 rounded-sm py-1 pr-1 pl-0.5 text-left text-sm font-semibold text-fg hover:text-primary"
            >
              <ChevronRight
                aria-hidden
                className={cn('size-4 shrink-0 text-fg-subtle transition-transform', !collapsed && 'rotate-90')}
              />
              <span className="truncate">{containerName(container)}</span>
            </button>
          </h2>
          {sprint && <SprintDates sprint={sprint} />}
          <span className="text-xs text-fg-subtle tabular-nums">
            {filtering && issues.length !== container.issues.length
              ? `${issues.length} of ${pluralize(container.issues.length, 'issue')}`
              : pluralize(container.issues.length, 'issue')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PointsSummary points={points} />
          {actions.canEdit && sprint && <SprintActions container={container} sprint={sprint} />}
          {actions.canEdit && container.kind === 'backlog' && <CreateSprintButton />}
        </div>
      </div>
      {sprint && !collapsed && <SprintSubline sprint={sprint} />}

      {!collapsed && (
        <div id={bodyId} className="@container mt-1.5">
          <SortableContext id={container.id} items={ids} strategy={verticalListSortingStrategy}>
            {issues.length > 0 ? (
              <div className="overflow-hidden rounded-md border border-border bg-surface">
                {issues.map((issue) => (
                  <SortableBacklogRow
                    key={issue.key}
                    issue={issue}
                    disabled={!actions.canEdit}
                    selected={actions.currentIssueKey === issue.key}
                    onOpen={actions.openIssue}
                  />
                ))}
              </div>
            ) : (
              <EmptySection container={container} hiddenCount={filtering ? container.issues.length : 0} />
            )}
          </SortableContext>
          {actions.canEdit && (
            <QuickCreate
              projectKey={actions.projectKey}
              containerId={container.id}
              sprintId={containerSprintId(container)}
              parent={actions.quickCreateParent}
            />
          )}
        </div>
      )}
    </section>
  )
}

/** State lozenge (active) and date range of a sprint, inline in the header. */
function SprintDates({ sprint }: { sprint: Sprint }) {
  const range = formatDateRange(sprint.startDate, sprint.endDate)
  return (
    <>
      {sprint.state === 'active' && (
        <span
          className={cn(
            'inline-flex h-5 items-center rounded-[3px] px-1.5 text-2xs font-bold tracking-wide uppercase',
            SPRINT_STATE_META.active.lozengeClassName,
          )}
        >
          {SPRINT_STATE_META.active.label}
        </span>
      )}
      {range && <span className="text-xs whitespace-nowrap text-fg-muted">{range}</span>}
    </>
  )
}

/** Second header line: days remaining (active sprint) and the sprint goal. */
function SprintSubline({ sprint }: { sprint: Sprint }) {
  const remaining = sprint.state === 'active' ? formatDaysRemaining(sprint.endDate) : ''
  const overdue = (daysRemaining(sprint.endDate) ?? 0) < 0
  if (!remaining && !sprint.goal) return null
  return (
    <p className="mt-0.5 flex min-w-0 items-baseline gap-2 pl-5.5 text-xs text-fg-muted">
      {remaining && (
        <span className={cn('shrink-0', overdue ? 'font-medium text-danger' : 'text-fg-subtle')}>{remaining}</span>
      )}
      {remaining && sprint.goal && (
        <span aria-hidden className="text-fg-subtle">
          ·
        </span>
      )}
      {sprint.goal && (
        <span className="min-w-0 truncate" title={sprint.goal}>
          <span className="font-medium text-fg-subtle">Goal: </span>
          {sprint.goal}
        </span>
      )}
    </p>
  )
}

/** Drop zone / message for a section with no visible rows. */
function EmptySection({ container, hiddenCount }: { container: BacklogContainer; hiddenCount: number }) {
  const { canEdit } = useBacklogActions()
  let text: string
  if (hiddenCount > 0) {
    text = `No issues here match your filters (${pluralize(hiddenCount, 'issue')} hidden).`
  } else if (container.kind === 'sprint') {
    text = canEdit
      ? 'Plan this sprint: drag issues here from the backlog or another sprint, or create new ones.'
      : 'No issues are planned for this sprint yet.'
  } else if (container.kind === 'backlog') {
    text = canEdit ? 'Your backlog is empty. Create an issue or drag one out of a sprint.' : 'The backlog is empty.'
  } else {
    text = canEdit ? 'No issues yet. Create the first one below.' : 'No issues yet.'
  }
  return (
    <div className="flex min-h-12 items-center justify-center rounded-md border border-dashed border-border-strong px-4 py-3 text-center text-xs text-fg-muted">
      {text}
    </div>
  )
}
