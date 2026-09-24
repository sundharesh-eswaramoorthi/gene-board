import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import type { EpicProgress } from '@/api/types'
import { useIssueModal } from '@/app/ModalsProvider'
import { DueDateLabel, IssueKeyLink, IssueTypeIcon, StatusLozenge, UserAvatar } from '@/components/issue'
import { cn } from '@/lib/cn'
import { epicColor } from '@/lib/colors'
import { EPIC_COLUMNS } from './epicColumns'
import { EpicChildren } from './EpicChildren'
import { EpicProgressBar } from './EpicProgressBar'
import { describeEpicPoints, epicCounts, isEpicDone } from './epicProgress'

/** Props of `EpicRow`. */
export interface EpicRowProps {
  projectKey: string
  progress: EpicProgress
  expanded: boolean
  onToggle: () => void
  canEdit: boolean
}

/** One epic: colour, key, summary, status, stacked progress, points, due date — expandable to its children. */
export function EpicRow({ projectKey, progress, expanded, onToggle, canEdit }: EpicRowProps) {
  const { openIssue } = useIssueModal()
  const regionId = useId()
  const { epic } = progress
  const counts = epicCounts(progress)
  const done = isEpicDone(progress)

  return (
    <li className="border-b border-border last:border-b-0" data-testid={`epic-row-${epic.key}`}>
      <div className={cn('flex min-h-12 items-center gap-3 px-3 py-2', expanded && 'bg-surface-sunken/60')}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${epic.key}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <ChevronRight aria-hidden className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
        </button>
        <span
          aria-hidden
          className="h-8 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: epicColor(epic.id) }}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IssueTypeIcon type="epic" />
          <IssueKeyLink issueKey={epic.key} tone="muted" done={done} className="text-xs" />
          <button
            type="button"
            onClick={() => openIssue(epic.key)}
            className="min-w-0 truncate rounded-sm text-left text-sm font-medium text-fg hover:text-primary hover:underline"
          >
            {epic.summary}
          </button>
        </div>
        <div className={EPIC_COLUMNS.status}>
          <StatusLozenge status={epic.status} />
        </div>
        <div className={cn(EPIC_COLUMNS.progress, 'flex-col gap-1')}>
          <EpicProgressBar progress={progress} />
          <span className="text-2xs text-fg-muted tabular-nums">
            {counts.total === 0 ? 'No child issues' : `${counts.done}/${counts.total} done · ${counts.percentDone}%`}
          </span>
        </div>
        <div className={cn(EPIC_COLUMNS.points, 'text-xs text-fg-muted tabular-nums')}>
          {describeEpicPoints(progress)}
        </div>
        <div className={cn(EPIC_COLUMNS.due, 'text-xs')}>
          <DueDateLabel date={epic.dueDate} resolved={done} emptyText="—" />
        </div>
        <div className={EPIC_COLUMNS.assignee}>
          <UserAvatar user={epic.assignee} size="sm" />
        </div>
      </div>
      {expanded && (
        <section
          id={regionId}
          aria-label={`Child issues of ${epic.key}`}
          className="animate-fade-in border-t border-border bg-surface-sunken/60 py-3 pr-3 pl-12"
        >
          <ProgressSummary progress={progress} />
          <EpicChildren projectKey={projectKey} epic={epic} expectedCount={counts.total} canEdit={canEdit} />
        </section>
      )}
    </li>
  )
}

/** One-line breakdown shown above the children (also covers columns hidden on narrow screens). */
function ProgressSummary({ progress }: { progress: EpicProgress }) {
  const c = epicCounts(progress)
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        {c.done} done
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-info" />
        {c.inProgress} in progress
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-neutral-subtle ring-1 ring-border-strong ring-inset" />
        {c.todo} to do
      </span>
      <span className="tabular-nums">{describeEpicPoints(progress)}</span>
    </div>
  )
}
