import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { cn } from '@/lib/cn'

/** Props of {@link FilterMenu}. */
export interface FilterMenuProps<V extends string | number> {
  /** Filter name shown on the button, e.g. "Type". */
  label: string
  options: readonly ComboboxOption<V>[]
  /** Selected values (at most one when `multiple` is false). */
  selected: readonly V[]
  onChange: (values: V[]) => void
  /** Multi-select with checkboxes (default) or pick-one. */
  multiple?: boolean
  loading?: boolean
  searchPlaceholder?: string
  emptyText?: ReactNode
  /** Popover width (default 260). */
  width?: number
  'data-testid'?: string
}

/**
 * Jira-style filter button ("Type ▾", "Status: In Progress", "Assignee 2") that opens a
 * searchable, keyboard-navigable option list. Highlighted while a value is selected, with a
 * "Clear" row at the bottom.
 */
export function FilterMenu<V extends string | number>({
  label,
  options,
  selected,
  onChange,
  multiple = true,
  loading = false,
  searchPlaceholder,
  emptyText,
  width = 260,
  'data-testid': testId,
}: FilterMenuProps<V>) {
  const active = selected.length > 0
  const single = selected.length === 1 ? options.find((o) => o.value === selected[0]) : undefined

  const trigger = (
    <Button
      size="sm"
      variant="secondary"
      data-testid={testId}
      aria-label={active ? `${label} filter: ${selected.length} selected` : `${label} filter`}
      iconRight={<ChevronDown />}
      className={cn(
        'max-w-64 data-[state=open]:border-primary',
        active && 'border-primary/40 bg-primary-subtle text-primary hover:bg-primary-subtle/80',
      )}
    >
      <span className="truncate">
        {label}
        {single && <span className="font-normal">: {single.label}</span>}
      </span>
      {selected.length > 1 && (
        <span className="rounded-full bg-primary px-1.5 text-2xs leading-4 font-semibold text-primary-fg tabular-nums">
          {selected.length}
        </span>
      )}
    </Button>
  )

  return (
    <Combobox
      trigger={trigger}
      options={options}
      selected={selected}
      multiple={multiple}
      loading={loading}
      searchPlaceholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
      emptyText={emptyText}
      width={width}
      aria-label={label}
      onSelect={(option) => {
        const isSelected = selected.includes(option.value)
        if (multiple) {
          onChange(isSelected ? selected.filter((v) => v !== option.value) : [...selected, option.value])
        } else {
          onChange(isSelected ? [] : [option.value])
        }
      }}
      footer={
        active ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex h-8 w-full items-center rounded-sm px-2 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            Clear {label.toLowerCase()}
          </button>
        ) : undefined
      }
    />
  )
}
