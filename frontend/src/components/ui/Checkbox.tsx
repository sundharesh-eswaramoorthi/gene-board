import { Check, Minus } from 'lucide-react'
import { Checkbox as RadixCheckbox } from 'radix-ui'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Props of `Checkbox`. */
export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onCheckedChange: (checked: boolean) => void
  /** Visible label (clickable). Omit and pass `aria-label` for icon-only use. */
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
}

/** Accessible checkbox (Radix) with optional label and description. */
export function Checkbox({ checked, onCheckedChange, label, description, disabled, id, className, ...aria }: CheckboxProps) {
  const autoId = useId()
  const boxId = id ?? `cb-${autoId}`
  const box = (
    <RadixCheckbox.Root
      id={boxId}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      className={cn(
        'peer flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-border-strong bg-surface transition-colors',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-fg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        !label && className,
      )}
      {...aria}
    >
      <RadixCheckbox.Indicator>
        {checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
  if (!label) return box
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <div className="flex h-5 items-center">{box}</div>
      <div className="min-w-0">
        <label htmlFor={boxId} className="cursor-pointer text-sm text-fg select-none peer-disabled:cursor-not-allowed">
          {label}
        </label>
        {description && <p className="text-xs text-fg-muted">{description}</p>}
      </div>
    </div>
  )
}
