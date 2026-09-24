import { useMemo } from 'react'
import type { ID, IssueSprintRef, Sprint } from '@/api/types'
import { useSprints } from '@/api/sprints'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { formatDateRange } from '@/lib/dates'
import { PickerPlaceholder, PickerTrigger, type PickerCommonProps } from './PickerTrigger'

const BACKLOG = -1

/** Props of `SprintSelect`. */
export interface SprintSelectProps extends PickerCommonProps {
  projectKey: string
  /** Sprint id, the issue's sprint ref, or `null` for the backlog. */
  value: ID | IssueSprintRef | null
  onChange: (sprintId: ID | null, sprint: Sprint | null) => void
  /** Offer "Backlog" (no sprint). Default true. */
  allowBacklog?: boolean
  /** Label of the no-sprint option / empty value (default "Backlog"). */
  backlogLabel?: string
}

/** Sprint picker: active + planned sprints of the project, plus "Backlog". */
export function SprintSelect({
  projectKey,
  value,
  onChange,
  allowBacklog = true,
  backlogLabel = 'Backlog',
  variant = 'field',
  disabled,
  placeholder,
  className,
  trigger,
  align,
  open,
  onOpenChange,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: SprintSelectProps) {
  const sprints = useSprints(projectKey, ['planned', 'active'])
  const valueId = typeof value === 'number' ? value : (value?.id ?? null)
  const currentName =
    sprints.data?.find((s) => s.id === valueId)?.name ?? (typeof value === 'object' && value ? value.name : null)

  const triggerEl = trigger ?? (
    <PickerTrigger
      variant={variant}
      disabled={disabled}
      className={className}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? `Sprint: ${currentName ?? backlogLabel}`}
    >
      {currentName ? (
        <span className="truncate">{currentName}</span>
      ) : (
        <PickerPlaceholder>{placeholder ?? backlogLabel}</PickerPlaceholder>
      )}
    </PickerTrigger>
  )
  const options = useMemo(() => {
    const list: ComboboxOption<ID>[] = (sprints.data ?? []).map((s) => ({
      value: s.id,
      label: s.name,
      description: s.state === 'active' ? 'Active' : formatDateRange(s.startDate, s.endDate) || 'Planned',
    }))
    if (allowBacklog) list.push({ value: BACKLOG, label: backlogLabel })
    return list
  }, [sprints.data, allowBacklog, backlogLabel])

  if (disabled) return triggerEl

  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={valueId ?? BACKLOG}
      loading={sprints.isLoading}
      emptyText="No open sprints"
      searchPlaceholder="Search sprints…"
      width={300}
      align={align}
      open={open}
      onOpenChange={onOpenChange}
      aria-label="Sprints"
      onSelect={(o) => {
        const nextId = o.value === BACKLOG ? null : o.value
        if (nextId === valueId) return
        onChange(nextId, sprints.data?.find((s) => s.id === nextId) ?? null)
      }}
    />
  )
}
