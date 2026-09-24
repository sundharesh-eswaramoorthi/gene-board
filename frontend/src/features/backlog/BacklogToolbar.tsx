import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import type { IssueRef } from '@/api/types'
import { EpicChip } from '@/components/issue'
import { Button, SearchInput } from '@/components/ui'
import { AssigneeFilter } from './AssigneeFilter'
import { EMPTY_FILTERS, hasActiveFilters, type BacklogFilters, type EpicFilter } from './model'

/** Props of `BacklogToolbar`. */
export interface BacklogToolbarProps {
  projectKey: string
  filters: BacklogFilters
  onFiltersChange: (update: (prev: BacklogFilters) => BacklogFilters) => void
  /** The selected epic (for the filter tag while the panel is hidden). */
  selectedEpic: Pick<IssueRef, 'id' | 'key' | 'summary'> | null
  panelOpen: boolean
  onTogglePanel: () => void
  visibleCount: number
  totalCount: number
}

/** Search, assignee avatars, Epics panel toggle, active epic tag, clear filters and a result count. */
export function BacklogToolbar({
  projectKey,
  filters,
  onFiltersChange,
  selectedEpic,
  panelOpen,
  onTogglePanel,
  visibleCount,
  totalCount,
}: BacklogToolbarProps) {
  const active = hasActiveFilters(filters)
  const setEpic = (epic: EpicFilter) => onFiltersChange((f) => ({ ...f, epic }))
  return (
    <>
      <SearchInput
        value={filters.query}
        onChange={(query) => onFiltersChange((f) => ({ ...f, query }))}
        placeholder="Search backlog"
        className="w-full sm:w-56"
        data-testid="backlog-search"
      />
      <AssigneeFilter
        projectKey={projectKey}
        value={filters.assignees}
        onChange={(assignees) => onFiltersChange((f) => ({ ...f, assignees }))}
      />
      <Button
        variant={panelOpen ? 'secondary' : 'subtle'}
        icon={panelOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        aria-pressed={panelOpen}
        onClick={onTogglePanel}
        data-testid="backlog-toggle-epics"
      >
        Epics
      </Button>
      {!panelOpen && filters.epic !== null && (
        <span className="inline-flex h-7 items-center gap-1 rounded-sm border border-border-strong bg-surface pr-0.5 pl-2 text-xs text-fg-muted">
          Epic:
          {filters.epic === 'none' ? (
            <span className="font-medium text-fg">None</span>
          ) : selectedEpic ? (
            <EpicChip epic={selectedEpic} />
          ) : null}
          <button
            type="button"
            aria-label="Clear epic filter"
            onClick={() => setEpic(null)}
            className="flex size-5 items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      )}
      {active && (
        <>
          <Button variant="subtle" size="sm" onClick={() => onFiltersChange(() => EMPTY_FILTERS)}>
            Clear filters
          </Button>
          <span className="ml-auto text-xs text-fg-muted tabular-nums" aria-live="polite">
            Showing {visibleCount} of {totalCount} {totalCount === 1 ? 'issue' : 'issues'}
          </span>
        </>
      )}
    </>
  )
}
