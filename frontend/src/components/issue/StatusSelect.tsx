import { ChevronDown } from 'lucide-react'
import type { ID, Status } from '@/api/types'
import { useStatuses } from '@/api/statuses'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { cn } from '@/lib/cn'
import { PickerPlaceholder, PickerTrigger, type PickerCommonProps, type PickerVariant } from './PickerTrigger'
import { StatusLozenge } from './StatusLozenge'

const BUTTON_TONES: Record<Status['category'], string> = {
  todo: 'bg-neutral-subtle text-fg hover:bg-neutral-subtle/70',
  in_progress: 'bg-info-subtle text-info hover:bg-info-subtle/70',
  done: 'bg-success-subtle text-success hover:bg-success-subtle/70',
}

/** Props of `StatusSelect`. */
export interface StatusSelectProps extends Omit<PickerCommonProps, 'variant'> {
  projectKey: string
  /** Status id or the issue's Status object (shown before the list loads). */
  value: ID | Pick<Status, 'id' | 'name' | 'category'> | null
  onChange: (statusId: ID, status: Status) => void
  /**
   * `field` / `inline` show the lozenge; `compact` shows a small lozenge; `button` is the
   * prominent category-coloured status button of the issue view.
   */
  variant?: PickerVariant | 'button'
  /** Use these statuses instead of fetching (e.g. from the board response). */
  statuses?: readonly Status[]
}

/** Workflow status picker for a project (options = the project's columns, in order). */
export function StatusSelect({
  projectKey,
  value,
  onChange,
  variant = 'field',
  statuses: statusesProp,
  disabled,
  placeholder = 'Select status',
  className,
  trigger,
  align,
  open,
  onOpenChange,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: StatusSelectProps) {
  const query = useStatuses(projectKey, { enabled: !statusesProp })
  const statuses = statusesProp ?? query.data ?? []
  const valueId = typeof value === 'number' ? value : (value?.id ?? null)
  const current = statuses.find((s) => s.id === valueId) ?? (typeof value === 'object' ? value : null)

  const label = ariaLabel ?? `Status: ${current?.name ?? 'none'}`
  let triggerEl = trigger
  if (!triggerEl) {
    if (variant === 'button') {
      triggerEl = (
        <PickerTrigger
          variant="compact"
          disabled={disabled}
          id={id}
          data-testid={testId}
          aria-label={label}
          hideChevron
          className={cn(
            'h-8 gap-1.5 px-3 text-sm font-semibold',
            current ? BUTTON_TONES[current.category] : 'bg-neutral-subtle text-fg',
            disabled && 'hover:bg-inherit',
            className,
          )}
        >
          <span className="max-w-48 truncate">{current?.name ?? placeholder}</span>
          {!disabled && <ChevronDown aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
        </PickerTrigger>
      )
    } else {
      triggerEl = (
        <PickerTrigger
          variant={variant}
          disabled={disabled}
          className={className}
          id={id}
          data-testid={testId}
          aria-label={label}
        >
          {current ? <StatusLozenge status={current} /> : <PickerPlaceholder>{placeholder}</PickerPlaceholder>}
        </PickerTrigger>
      )
    }
  }
  if (disabled) return triggerEl

  const options: ComboboxOption<ID>[] = statuses.map((s) => ({
    value: s.id,
    label: s.name,
    render: (
      <span className="flex min-w-0 flex-1">
        <StatusLozenge status={s} />
      </span>
    ),
  }))
  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={valueId}
      loading={query.isLoading && !statusesProp}
      emptyText="No statuses"
      width={240}
      align={align}
      open={open}
      onOpenChange={onOpenChange}
      aria-label="Statuses"
      searchPlaceholder="Search statuses…"
      onSelect={(o) => {
        const status = statuses.find((s) => s.id === o.value)
        if (status && status.id !== valueId) onChange(status.id, status)
      }}
    />
  )
}
