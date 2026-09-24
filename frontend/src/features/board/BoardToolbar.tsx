import { ChevronDown, Layers, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { IssueType } from '@/api/types'
import { IssueTypeIcon } from '@/components/issue/IssueTypeIcon'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { Button, type ButtonProps } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { SearchInput } from '@/components/ui/Input'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { epicColor } from '@/lib/colors'
import { pluralize } from '@/lib/format'
import { ISSUE_TYPE_META } from '@/lib/issueMeta'
import {
  BOARD_ISSUE_TYPES,
  pruneFilters,
  toggleValue,
  type AssigneeFilterValue,
  type BoardFilterOptions,
  type BoardFilters,
  type EpicFilterValue,
} from './boardFilters'

/** How many assignee avatars are shown before the rest collapse into "+n". */
const MAX_AVATARS = 5

/** Props of `BoardToolbar`. */
export interface BoardToolbarProps {
  filters: BoardFilters
  options: BoardFilterOptions
  onChange: (patch: Partial<BoardFilters>) => void
  onClear: () => void
  /** Filters are narrowing the board. */
  active: boolean
  /** Issues shown / on the board (for the "Showing x of y" hint). */
  shownCount: number
  totalCount: number
}

/**
 * Board quick filters (client-side): text search, assignee avatars (+ Unassigned), only my
 * issues, type, epic, hide subtasks and "Clear filters".
 */
export function BoardToolbar({ filters: stored, options, onChange, onClear, active, shownCount, totalCount }: BoardToolbarProps) {
  // Selected epics and people no longer on the board have no control here and the board ignores
  // them (useBoardView), so counts and toggles leave them out too: the next toggle drops them.
  const filters = pruneFilters(stored, options)
  return (
    <div role="toolbar" aria-label="Board filters" className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <SearchInput
        value={filters.text}
        onChange={(text) => onChange({ text })}
        placeholder="Search board"
        aria-label="Search this board"
        className="w-48"
      />
      <AssigneeFilter
        options={options}
        selected={filters.assignees}
        onChange={(assignees) => onChange({ assignees })}
      />
      <FilterToggle pressed={filters.onlyMine} onPressedChange={(onlyMine) => onChange({ onlyMine })}>
        Only my issues
      </FilterToggle>
      <TypeFilter selected={filters.types} onChange={(types) => onChange({ types })} />
      <EpicFilter options={options} selected={filters.epics} onChange={(epics) => onChange({ epics })} />
      {(options.hasSubtasks || filters.hideSubtasks) && (
        <FilterToggle pressed={filters.hideSubtasks} onPressedChange={(hideSubtasks) => onChange({ hideSubtasks })}>
          Hide subtasks
        </FilterToggle>
      )}
      {active && (
        <>
          <Button variant="subtle" size="md" icon={<X />} onClick={onClear}>
            Clear filters
          </Button>
          <span className="text-xs text-fg-subtle" aria-live="polite">
            Showing {shownCount} of {pluralize(totalCount, 'issue')}
          </span>
        </>
      )}
    </div>
  )
}

/** A toggle button styled like Jira's quick filters (highlighted while on). */
function FilterToggle({
  pressed,
  onPressedChange,
  children,
}: {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  children: ReactNode
}) {
  return (
    <Button
      variant="subtle"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(pressed && 'bg-primary-subtle text-primary hover:bg-primary-subtle hover:text-primary')}
    >
      {children}
    </Button>
  )
}

/**
 * Dropdown trigger showing how many values are selected. Used as a Radix `asChild` trigger, so it
 * forwards the injected props and ref to the Button.
 */
function MenuTriggerButton({ label, count, className, ...props }: ButtonProps & { label: string; count: number }) {
  return (
    <Button
      variant="subtle"
      iconRight={<ChevronDown />}
      aria-label={count > 0 ? `${label}, ${count} selected` : label}
      {...props}
      className={cn(count > 0 && 'bg-primary-subtle text-primary hover:bg-primary-subtle hover:text-primary', className)}
    >
      {label}
      {count > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold text-primary-fg tabular-nums">
          {count}
        </span>
      )}
    </Button>
  )
}

function AssigneeFilter({
  options,
  selected,
  onChange,
}: {
  options: BoardFilterOptions
  selected: readonly AssigneeFilterValue[]
  onChange: (value: AssigneeFilterValue[]) => void
}) {
  const shown = options.assignees.slice(0, MAX_AVATARS)
  const overflow = options.assignees.slice(MAX_AVATARS)
  const overflowSelected = overflow.filter((u) => selected.includes(u.id)).length
  if (options.assignees.length === 0 && !options.hasUnassigned) return null

  const avatarButton = (value: AssigneeFilterValue, label: string, avatar: ReactNode) => {
    const isOn = selected.includes(value)
    return (
      <Tooltip key={value} content={label}>
        <button
          type="button"
          aria-pressed={isOn}
          aria-label={label}
          onClick={() => onChange(toggleValue(selected, value))}
          className={cn(
            'relative rounded-full ring-2 ring-surface transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10',
            isOn && 'z-10 ring-primary',
          )}
        >
          {avatar}
        </button>
      </Tooltip>
    )
  }

  return (
    <div role="group" aria-label="Filter by assignee" className="flex items-center pl-1">
      <div className="flex items-center -space-x-1">
        {shown.map((user) => avatarButton(user.id, user.name, <UserAvatar user={user} size="lg" tooltip={false} />))}
        {options.hasUnassigned && avatarButton('none', 'Unassigned', <UserAvatar user={null} size="lg" tooltip={false} />)}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${overflow.length} more assignees`}
                className={cn(
                  'relative flex size-8 items-center justify-center rounded-full bg-neutral-subtle text-xs font-semibold text-fg-muted ring-2 ring-surface hover:z-10 hover:bg-surface-hover',
                  overflowSelected > 0 && 'z-10 bg-primary-subtle text-primary ring-primary',
                )}
              >
                +{overflow.length}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>More assignees</DropdownMenuLabel>
              {overflow.map((user) => (
                <DropdownMenuCheckboxItem
                  key={user.id}
                  checked={selected.includes(user.id)}
                  onCheckedChange={() => onChange(toggleValue(selected, user.id))}
                  onSelect={(e) => e.preventDefault()}
                >
                  <UserAvatar user={user} size="sm" showName />
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function TypeFilter({ selected, onChange }: { selected: readonly IssueType[]; onChange: (value: IssueType[]) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MenuTriggerButton label="Type" count={selected.length} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {BOARD_ISSUE_TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={selected.includes(type)}
            onCheckedChange={() => onChange(toggleValue(selected, type))}
            onSelect={(e) => e.preventDefault()}
          >
            <IssueTypeIcon type={type} title={false} />
            {ISSUE_TYPE_META[type].label}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<X />} onSelect={() => onChange([])}>
              Clear type filter
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EpicFilter({
  options,
  selected,
  onChange,
}: {
  options: BoardFilterOptions
  selected: readonly EpicFilterValue[]
  onChange: (value: EpicFilterValue[]) => void
}) {
  const empty = options.epics.length === 0 && !options.hasIssuesWithoutEpic
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MenuTriggerButton label="Epic" count={selected.length} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-w-80">
        {empty && <p className="px-2 py-1.5 text-sm text-fg-subtle">No issues on the board</p>}
        {options.epics.map((epic) => (
          <DropdownMenuCheckboxItem
            key={epic.id}
            checked={selected.includes(epic.id)}
            onCheckedChange={() => onChange(toggleValue(selected, epic.id))}
            onSelect={(e) => e.preventDefault()}
          >
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: epicColor(epic.id) }} />
            <span className="min-w-0 flex-1 truncate" title={`${epic.key}: ${epic.summary}`}>
              {epic.summary}
            </span>
            <span className="shrink-0 text-xs text-fg-subtle">{epic.key}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {options.hasIssuesWithoutEpic && (
          <>
            {options.epics.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuCheckboxItem
              checked={selected.includes('none')}
              onCheckedChange={() => onChange(toggleValue(selected, 'none'))}
              onSelect={(e) => e.preventDefault()}
            >
              <Layers className="size-4 text-fg-subtle" aria-hidden />
              Issues without epic
            </DropdownMenuCheckboxItem>
          </>
        )}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<X />} onSelect={() => onChange([])}>
              Clear epic filter
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
