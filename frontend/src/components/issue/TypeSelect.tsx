import type { IssueType } from '@/api/types'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { ISSUE_TYPE_META, ISSUE_TYPES } from '@/lib/issueMeta'
import { IssueTypeIcon } from './IssueTypeIcon'
import { PickerTrigger, type PickerCommonProps } from './PickerTrigger'

/** Props of `TypeSelect`. */
export interface TypeSelectProps extends PickerCommonProps {
  value: IssueType
  onChange: (type: IssueType) => void
  /** Offered types (default: all). Use `allowedTypeChanges(type)` when editing an issue. */
  types?: readonly IssueType[]
}

/** Issue type picker (icon + name). `compact` shows only the icon. */
export function TypeSelect({
  value,
  onChange,
  types = ISSUE_TYPES,
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
}: TypeSelectProps) {
  const meta = ISSUE_TYPE_META[value]
  const triggerEl = trigger ?? (
    <PickerTrigger
      variant={variant}
      disabled={disabled}
      className={className}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? `Issue type: ${meta.label}`}
    >
      <IssueTypeIcon type={value} title={false} />
      {variant !== 'compact' && <span className="truncate">{meta.label}</span>}
    </PickerTrigger>
  )
  if (disabled) return triggerEl

  const options: ComboboxOption<IssueType>[] = types.map((t) => ({
    value: t,
    label: ISSUE_TYPE_META[t].label,
    icon: <IssueTypeIcon type={t} title={false} />,
  }))
  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={value}
      searchable={false}
      width={220}
      align={align}
      open={open}
      onOpenChange={onOpenChange}
      aria-label="Issue types"
      onSelect={(o) => o.value !== value && onChange(o.value)}
    />
  )
}
