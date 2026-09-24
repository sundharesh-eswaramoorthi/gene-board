import { ChevronDown } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react'
import { useFieldControl } from '@/components/ui/Field'
import { controlClasses } from '@/components/ui/Input'
import { cn } from '@/lib/cn'

/**
 * Picker appearance:
 * - `field`   — bordered, full-width control for forms (default)
 * - `inline`  — borderless value that highlights on hover (issue detail side panel)
 * - `compact` — minimal icon/avatar-only button (table rows, cards)
 */
export type PickerVariant = 'field' | 'inline' | 'compact'

/** Props shared by every picker in components/issue. */
export interface PickerCommonProps {
  variant?: PickerVariant
  /** Read-only: renders the current value without opening. */
  disabled?: boolean
  /** Text shown when there is no value. */
  placeholder?: string
  /** Classes for the built-in trigger. */
  className?: string
  /** Trigger id (auto-wired inside a `Field`). */
  id?: string
  'aria-label'?: string
  'data-testid'?: string
  /**
   * Custom trigger element (e.g. `<Button>` or a card-sized avatar button). It is rendered via
   * Radix `asChild`, so it must spread props and forward `ref` (all ui Buttons do).
   */
  trigger?: ReactElement
  /** Popover alignment relative to the trigger (default `start`). */
  align?: 'start' | 'center' | 'end'
  /** Controlled open state (optional). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Props of `PickerTrigger`. */
export interface PickerTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PickerVariant
  /** Hide the chevron (field variant shows it by default). */
  hideChevron?: boolean
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/** The built-in trigger button used by pickers (exported for custom pickers). */
export function PickerTrigger({ variant = 'field', hideChevron, className, children, disabled, ref, ...rest }: PickerTriggerProps) {
  const props = useFieldControl(rest)
  const chevron = !hideChevron && variant !== 'compact' && (
    <ChevronDown
      aria-hidden
      className={cn(
        'ml-auto size-4 shrink-0 text-fg-subtle transition-opacity',
        variant === 'inline' && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100',
        disabled && 'hidden',
      )}
    />
  )
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        'group flex min-w-0 items-center gap-2 text-left text-sm',
        variant === 'field' && cn(controlClasses, 'h-8 px-2.5 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-ring/25'),
        variant === 'inline' &&
          cn(
            '-mx-2 min-h-8 w-[calc(100%+1rem)] rounded-sm px-2 py-1 transition-colors',
            disabled ? 'cursor-default' : 'hover:bg-surface-hover data-[state=open]:bg-surface-hover',
          ),
        variant === 'compact' &&
          cn(
            'h-7 w-auto shrink-0 justify-center rounded-sm px-1 transition-colors',
            disabled ? 'cursor-default' : 'hover:bg-surface-hover data-[state=open]:bg-surface-hover',
          ),
        variant !== 'field' && 'disabled:opacity-100',
        className,
      )}
      {...props}
    >
      {children}
      {chevron}
    </button>
  )
}

/** Muted placeholder text for empty picker values. */
export function PickerPlaceholder({ children }: { children: ReactNode }) {
  return <span className="truncate text-fg-subtle">{children}</span>
}
