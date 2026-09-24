import { ArrowUpRight, CircleDashed, Layers, PanelLeftClose, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEpics } from '@/api/board'
import type { EpicProgress } from '@/api/types'
import { useCreateIssueModal, useIssueModal } from '@/app/ModalsProvider'
import { Button, ErrorState, IconButton, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { epicColor } from '@/lib/colors'
import { useLocalStorageState } from '@/lib/hooks'
import { EpicProgressBar } from '@/features/epics/EpicProgressBar'
import { describeEpicPoints, epicCounts, isEpicDone } from '@/features/epics/epicProgress'
import type { EpicFilter } from './model'

const SHOW_DONE_STORAGE_KEY = 'gb-backlog-epics-show-done'

/** Props of `EpicsPanel`. */
export interface EpicsPanelProps {
  projectKey: string
  value: EpicFilter
  onChange: (value: EpicFilter) => void
  onClose: () => void
  canEdit: boolean
}

/**
 * Collapsible left panel of the backlog listing the project's epics with progress. Selecting an
 * epic filters the backlog to its issues; "Issues without epic" shows the unparented ones.
 * Done epics are tucked away behind a toggle (like Jira).
 */
export function EpicsPanel({ projectKey, value, onChange, onClose, canEdit }: EpicsPanelProps) {
  const epics = useEpics(projectKey)
  const { openCreateIssue } = useCreateIssueModal()
  const [showDone, setShowDone] = useLocalStorageState(SHOW_DONE_STORAGE_KEY, false)

  const all = epics.data ?? []
  const doneCount = all.filter(isEpicDone).length
  const shown = all.filter((p) => showDone || !isEpicDone(p) || p.epic.id === value)

  let list: ReactNode
  if (epics.isPending) {
    list = (
      <div className="flex flex-col gap-2 px-1 pt-1" aria-busy="true" aria-label="Loading epics">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md px-2.5 py-2">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    )
  } else if (epics.isLoadingError) {
    list = <ErrorState size="sm" error={epics.error} title="Couldn’t load epics" onRetry={() => void epics.refetch()} />
  } else if (all.length === 0) {
    list = (
      <p className="px-2.5 py-3 text-xs text-fg-muted">
        No epics yet. Epics group related stories, tasks and bugs.
      </p>
    )
  } else {
    list = (
      <ul className="flex flex-col gap-1" aria-label="Epics">
        {shown.map((p) => (
          <EpicItem
            key={p.epic.id}
            progress={p}
            selected={value === p.epic.id}
            onSelect={() => onChange(value === p.epic.id ? null : p.epic.id)}
          />
        ))}
        {shown.length === 0 && <li className="px-2.5 py-2 text-xs text-fg-muted">All epics are done.</li>}
      </ul>
    )
  }

  return (
    <aside
      aria-label="Epics panel"
      className="flex w-64 shrink-0 flex-col border-r border-border bg-surface"
      data-testid="backlog-epics-panel"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
        <h2 className="flex-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Epics</h2>
        <IconButton size="xs" label="Hide epics panel" icon={<PanelLeftClose />} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-0.5" role="group" aria-label="Epic filter">
          <FilterOption icon={<Layers />} selected={value === null} onSelect={() => onChange(null)}>
            All issues
          </FilterOption>
          <FilterOption
            icon={<CircleDashed />}
            selected={value === 'none'}
            onSelect={() => onChange(value === 'none' ? null : 'none')}
            data-testid="backlog-epic-filter-none"
          >
            Issues without epic
          </FilterOption>
        </div>
        <div className="my-2 h-px bg-border" />
        {list}
        {doneCount > 0 && (
          <button
            type="button"
            onClick={() => setShowDone(!showDone)}
            aria-pressed={showDone}
            className="mt-2 w-full rounded-sm px-2.5 py-1.5 text-left text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            {showDone ? 'Hide done epics' : `Show done epics (${doneCount})`}
          </button>
        )}
      </div>
      {canEdit && (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            variant="subtle"
            size="sm"
            fullWidth
            icon={<Plus />}
            className="justify-start"
            onClick={() => openCreateIssue({ projectKey, type: 'epic' })}
            data-testid="backlog-create-epic"
          >
            Create epic
          </Button>
        </div>
      )}
    </aside>
  )
}

function FilterOption({
  icon,
  selected,
  onSelect,
  children,
  'data-testid': testId,
}: {
  icon: ReactNode
  selected: boolean
  onSelect: () => void
  children: ReactNode
  'data-testid'?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
        selected ? 'bg-surface-selected font-medium text-primary' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function EpicItem({ progress, selected, onSelect }: { progress: EpicProgress; selected: boolean; onSelect: () => void }) {
  const { openIssue } = useIssueModal()
  const { epic } = progress
  const c = epicCounts(progress)
  const done = isEpicDone(progress)
  return (
    <li className="group relative">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        data-testid={`backlog-epic-filter-${epic.key}`}
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-md border px-2.5 py-2 text-left transition-colors',
          selected ? 'border-primary bg-surface-selected' : 'border-transparent hover:bg-surface-hover',
        )}
      >
        <span className="flex items-start gap-2 pr-6">
          <span
            aria-hidden
            className="mt-1 size-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: epicColor(epic.id) }}
          />
          <span className="flex min-w-0 flex-col">
            <span className={cn('line-clamp-2 text-sm font-medium text-fg', done && 'text-fg-muted')}>{epic.summary}</span>
            <span className={cn('text-2xs text-fg-subtle', done && 'line-through')}>{epic.key}</span>
          </span>
        </span>
        <EpicProgressBar progress={progress} />
        <span className="flex items-center justify-between gap-2 text-2xs text-fg-muted tabular-nums">
          <span>{c.total === 0 ? 'No issues' : `${c.done}/${c.total} done`}</span>
          <span>{describeEpicPoints(progress)}</span>
        </span>
      </button>
      <IconButton
        size="xs"
        label={`Open ${epic.key}`}
        tooltip="View epic details"
        icon={<ArrowUpRight />}
        onClick={() => openIssue(epic.key)}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </li>
  )
}
