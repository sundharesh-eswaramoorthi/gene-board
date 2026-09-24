import type { Priority } from '@/api/types'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { PRIORITIES, PRIORITY_META } from '@/lib/issueMeta'
import { PickerTrigger, type PickerCommonProps } from './PickerTrigger'
import { PriorityIcon } from './PriorityIcon'

/** Props of `PrioritySelect`. */
export interface PrioritySelectProps extends PickerCommonProps {
  value: Priority
  onChange: (priority: Priority) => void
}

/** Priority picker (Highest → Lowest). `compact` shows only the icon. */
export function PrioritySelect({
  value,
  onChange,
  variant = 'field',
  disabled,
  className,
  trigger,
  align,
  open,
  onOpenChange,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: PrioritySelectProps) {
  const triggerEl = trigger ?? (
    <PickerTrigger
      variant={variant}
      disabled={disabled}
      className={className}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? `Priority: ${PRIORITY_META[value].label}`}
    >
      {variant === 'compact' ? <PriorityIcon priority={value} /> : <PriorityIcon priority={value} showLabel />}
    </PickerTrigger>
  )
  if (disabled) return triggerEl

  const options: ComboboxOption<Priority>[] = PRIORITIES.map((p) => ({
    value: p,
    label: PRIORITY_META[p].label,
    icon: <PriorityIcon priority={p} />,
  }))
  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={value}
      searchable={false}
      width={200}
      align={align}
      open={open}
      onOpenChange={onOpenChange}
      aria-label="Priorities"
      onSelect={(o) => o.value !== value && onChange(o.value)}
    />
  )
}
