import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CornerLeftUp } from 'lucide-react'
import { memo, type HTMLAttributes, type KeyboardEvent, type Ref } from 'react'
import type { ID, Issue } from '@/api/types'
import { EpicChip } from '@/components/issue/EpicChip'
import { IssueTypeIcon } from '@/components/issue/IssueTypeIcon'
import { LabelList } from '@/components/issue/LabelChip'
import { PriorityIcon } from '@/components/issue/PriorityIcon'
import { StoryPointsBadge } from '@/components/issue/StoryPointsBadge'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { cn } from '@/lib/cn'
import { ISSUE_TYPE_META, PRIORITY_META, formatPoints } from '@/lib/issueMeta'
import type { EpicOption } from './boardFilters'

/** Accessible name of a card: key, summary and the facts shown as icons. */
function cardLabel(issue: Issue, epic: EpicOption | null): string {
  const parts = [
    `${issue.key}: ${issue.summary}`,
    ISSUE_TYPE_META[issue.type].label,
    `${PRIORITY_META[issue.priority].label} priority`,
    issue.assignee ? `assigned to ${issue.assignee.name}` : 'unassigned',
  ]
  if (issue.storyPoints != null) parts.push(`${formatPoints(issue.storyPoints)} story points`)
  if (issue.type === 'subtask' && issue.parent) parts.push(`subtask of ${issue.parent.key}`)
  if (epic) parts.push(`epic ${epic.summary}`)
  if (issue.labels.length > 0) parts.push(`labels ${issue.labels.map((l) => l.name).join(', ')}`)
  return parts.join(', ')
}

interface CardContentProps {
  issue: Issue
  epic: EpicOption | null
  /** Avatar tooltips (off inside the drag overlay). */
  tooltips: boolean
}

function sameEpic(a: EpicOption | null, b: EpicOption | null): boolean {
  return a === b || (!!a && !!b && a.id === b.id && a.key === b.key && a.summary === b.summary)
}

/** Everything inside a card. */
function CardContentView({ issue, epic, tooltips }: CardContentProps) {
  const parent = issue.type === 'subtask' ? issue.parent : null
  const showChips = !!epic || issue.labels.length > 0
  return (
    <>
      {parent && (
        <p className="flex min-w-0 items-center gap-1 text-2xs text-fg-subtle" aria-hidden>
          <CornerLeftUp className="size-3 shrink-0" />
          <span className="shrink-0 font-semibold text-fg-muted">{parent.key}</span>
          <span className="truncate">{parent.summary}</span>
        </p>
      )}
      <p className="line-clamp-2 text-sm break-words text-fg">{issue.summary}</p>
      {showChips && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {epic && <EpicChip epic={epic} />}
          <LabelList labels={issue.labels} max={2} />
        </div>
      )}
      <div className="flex min-h-5 items-center gap-2">
        <IssueTypeIcon type={issue.type} />
        <span className="truncate text-xs font-medium text-fg-muted">{issue.key}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StoryPointsBadge points={issue.storyPoints} />
          <PriorityIcon priority={issue.priority} size="sm" />
          <UserAvatar user={issue.assignee} size="sm" tooltip={tooltips} />
        </span>
      </div>
    </>
  )
}

/** Memoised (epics compared by value) so moving one card doesn't re-render the others. */
const CardContent = memo(
  CardContentView,
  (prev, next) => prev.issue === next.issue && prev.tooltips === next.tooltips && sameEpic(prev.epic, next.epic),
)

/** Visual state of a card. */
type CardVariant = 'default' | 'placeholder' | 'overlay'

interface IssueCardViewProps extends HTMLAttributes<HTMLDivElement> {
  issue: Issue
  epic: EpicOption | null
  variant?: CardVariant
  /** Can be picked up (grab cursor). */
  grabbable?: boolean
  ref?: Ref<HTMLDivElement>
}

/** The card surface. Interaction props (role, tabIndex, handlers) come from the wrappers below. */
function IssueCardView({ issue, epic, variant = 'default', grabbable = false, className, ref, ...props }: IssueCardViewProps) {
  return (
    <div
      ref={ref}
      aria-label={cardLabel(issue, epic)}
      className={cn(
        'relative flex flex-col gap-2 rounded-md border border-transparent bg-surface p-2.5 text-left shadow-card select-none',
        'transition-[background-color,box-shadow] outline-offset-1 hover:bg-surface-hover',
        grabbable ? 'cursor-grab' : 'cursor-pointer',
        variant === 'placeholder' &&
          'border-dashed border-primary/50 bg-primary-subtle/60 shadow-none hover:bg-primary-subtle/60 [&>*]:invisible',
        variant === 'overlay' && 'cursor-grabbing bg-surface shadow-raised ring-1 ring-primary/30 hover:bg-surface',
        className,
      )}
      {...props}
    >
      <CardContent issue={issue} epic={epic} tooltips={variant === 'default'} />
    </div>
  )
}

/** Props shared by the interactive card wrappers. */
interface CardProps {
  issue: Issue
  epic: EpicOption | null
  onOpen: (issueKey: string) => void
}

/**
 * Draggable card (members/admins): Space picks it up, arrows move it, Space/Enter drops, Escape
 * cancels; a plain click or Enter opens the issue.
 */
export function SortableIssueCard({ issue, epic, statusId, onOpen }: CardProps & { statusId: ID }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    data: { type: 'card', statusId },
    attributes: { roleDescription: 'draggable issue card' },
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter opens the issue — except while this card is being dragged, where Enter drops it.
    if (event.key === 'Enter' && !isDragging) {
      event.preventDefault()
      onOpen(issue.key)
      return
    }
    listeners?.onKeyDown?.(event)
  }

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <IssueCardView
        ref={setActivatorNodeRef}
        issue={issue}
        epic={epic}
        grabbable
        variant={isDragging ? 'placeholder' : 'default'}
        data-testid={`issue-card-${issue.key}`}
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        onClick={() => onOpen(issue.key)}
      />
    </li>
  )
}

/** Read-only card (viewers): a button that opens the issue. */
export function StaticIssueCard({ issue, epic, onOpen }: CardProps) {
  return (
    <li>
      <IssueCardView
        issue={issue}
        epic={epic}
        role="button"
        tabIndex={0}
        data-testid={`issue-card-${issue.key}`}
        onClick={() => onOpen(issue.key)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(issue.key)
          }
        }}
      />
    </li>
  )
}

/** The floating copy of a card that follows the pointer while dragging. */
export function IssueCardOverlay({ issue, epic }: { issue: Issue; epic: EpicOption | null }) {
  return <IssueCardView issue={issue} epic={epic} variant="overlay" aria-hidden className="rotate-2" />
}
