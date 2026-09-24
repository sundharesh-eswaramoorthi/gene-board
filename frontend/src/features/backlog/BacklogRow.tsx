import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, HTMLAttributes, KeyboardEvent, Ref } from 'react'
import type { Issue } from '@/api/types'
import {
  EpicChip,
  IssueKeyLink,
  IssueTypeIcon,
  LabelList,
  PriorityIcon,
  StatusLozenge,
  StoryPointsBadge,
  UserAvatar,
} from '@/components/issue'
import { cn } from '@/lib/cn'
import { isDone } from '@/lib/issueMeta'
import { epicOf } from './model'

/** Props of the row's control (the summary): a focusable button with its own handlers. */
export type BacklogRowControlProps = HTMLAttributes<HTMLSpanElement> & { ref?: Ref<HTMLSpanElement> }

/** Props of `BacklogRowContent`. */
export interface BacklogRowContentProps extends HTMLAttributes<HTMLDivElement> {
  issue: Issue
  /** The issue is open in the issue modal. */
  selected?: boolean
  /** Placeholder left behind in the list while this row is dragged. */
  placeholder?: boolean
  /** Rendered inside the DragOverlay (floating copy). */
  overlay?: boolean
  /**
   * Makes the summary the row's control (role, tabIndex, keyboard handling). It sits beside the
   * key link and the epic chip, not around them, so those stay controls of their own.
   */
  control?: BacklogRowControlProps
  ref?: Ref<HTMLDivElement>
}

/** The control fills the row's height; the row draws its focus ring (see `ROW_FOCUS_CLASS`). */
const CONTROL_CLASS = 'flex min-w-0 flex-1 items-center self-stretch focus-visible:outline-none'

/**
 * The control's focus ring, drawn on the row so it outlines the whole row and stays visible while
 * the row is a drag placeholder (whose children are transparent).
 */
const ROW_FOCUS_CLASS =
  'has-[[role=button]:focus-visible]:outline-2 has-[[role=button]:focus-visible]:-outline-offset-2 has-[[role=button]:focus-visible]:outline-ring'

/**
 * Compact backlog row: type, key, summary, epic, labels, status, points, priority, assignee.
 * Secondary columns collapse on narrow lists (the list is a `@container`).
 */
export function BacklogRowContent({
  issue,
  selected = false,
  placeholder = false,
  overlay = false,
  control,
  className,
  ref,
  ...props
}: BacklogRowContentProps) {
  const epic = epicOf(issue)
  const done = isDone(issue)
  const summary = (
    <span className={cn('min-w-0 flex-1 truncate', done && 'text-fg-muted')} title={issue.summary}>
      {issue.summary}
    </span>
  )
  return (
    <div
      ref={ref}
      className={cn(
        'relative flex h-10 items-center gap-2 border-b border-border bg-surface px-3 text-sm select-none last:border-b-0',
        'cursor-pointer transition-colors hover:bg-surface-hover',
        control && ROW_FOCUS_CLASS,
        selected && 'bg-surface-selected hover:bg-surface-selected',
        // Transparent rather than hidden: the control keeps focus (and the row its ring) during a
        // keyboard move.
        placeholder && 'bg-primary-subtle hover:bg-primary-subtle *:opacity-0',
        overlay && 'cursor-grabbing rounded-sm border border-border shadow-raised last:border-b',
        className,
      )}
      {...props}
    >
      <IssueTypeIcon type={issue.type} />
      <IssueKeyLink issueKey={issue.key} tone="muted" done={done} className="text-xs" />
      {control ? (
        <span data-testid={`backlog-row-${issue.key}`} {...control} className={CONTROL_CLASS}>
          {summary}
        </span>
      ) : (
        summary
      )}
      {(epic || issue.labels.length > 0) && (
        // Chips may shrink (and truncate) so the summary always keeps most of the row.
        <span className="hidden max-w-[45%] min-w-0 items-center justify-end gap-1 @2xl:flex [&_.chip-tint]:min-w-0 [&_.chip-tint]:shrink">
          {epic && <EpicChip epic={epic} interactive={!overlay} />}
          <LabelList labels={issue.labels} max={2} />
        </span>
      )}
      <span className="hidden w-28 shrink-0 justify-end @md:flex">
        <StatusLozenge status={issue.status} />
      </span>
      <span className="flex w-7 shrink-0 justify-center">
        <StoryPointsBadge points={issue.storyPoints} showEmpty />
      </span>
      <PriorityIcon priority={issue.priority} />
      <UserAvatar user={issue.assignee} size="sm" />
    </div>
  )
}

/** Props of `SortableBacklogRow`. */
export interface SortableBacklogRowProps {
  issue: Issue
  /** Read-only (viewer): the row opens the issue but cannot be dragged. */
  disabled: boolean
  selected: boolean
  onOpen: (issueKey: string) => void
}

/**
 * Draggable row (dnd-kit sortable). Click or Enter opens the issue; Space picks it up for a
 * keyboard move (arrows move, Space/Enter drop, Escape cancels). The pointer picks the row up
 * anywhere; the keyboard only from its control (the summary), so keys pressed on the key link or
 * the epic chip do what those controls do.
 */
export function SortableBacklogRow({ issue, disabled, selected, onOpen }: SortableBacklogRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, active } =
    useSortable({ id: issue.key, disabled })
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  const { onKeyDown: keyboardListener, ...pointerListeners } = listeners ?? {}

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    keyboardListener?.(event)
    // While any keyboard drag is in progress Enter/Space belong to the drag sensor.
    if (event.defaultPrevented || active) return
    if (event.key === 'Enter' || (disabled && event.key === ' ')) {
      event.preventDefault()
      onOpen(issue.key)
    }
  }

  return (
    <BacklogRowContent
      ref={setNodeRef}
      style={style}
      issue={issue}
      selected={selected}
      placeholder={isDragging}
      {...pointerListeners}
      onClick={() => onOpen(issue.key)}
      control={{
        ...attributes,
        ref: setActivatorNodeRef,
        // The row's primary action (open) stays available when dragging is disabled (viewers).
        'aria-disabled': undefined,
        'aria-describedby': disabled ? undefined : attributes['aria-describedby'],
        'aria-label': `${issue.key}: ${issue.summary}`,
        'aria-roledescription': disabled ? 'issue' : 'draggable issue',
        onKeyDown,
      }}
    />
  )
}
