import { createContext, use, useId, type AriaAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface FieldContextValue {
  id: string
  describedBy?: string
  invalid: boolean
  required: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

/**
 * Wires a control to its surrounding {@link Field}: returns `id`, `aria-describedby`,
 * `aria-invalid` and `required` unless the control's own props override them. Used by Input,
 * Textarea, Select and the pickers — call it in custom controls too.
 */
export function useFieldControl<
  P extends {
    id?: string
    'aria-describedby'?: string
    'aria-invalid'?: AriaAttributes['aria-invalid']
    required?: boolean
  },
>(props: P): P {
  const field = use(FieldContext)
  if (!field) return props
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': props['aria-describedby'] ?? field.describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    required: props.required ?? (field.required || undefined),
  }
}

/** Props of `Field`. */
export interface FieldProps {
  /** Visible label. */
  label: ReactNode
  /** The control (Input, Textarea, Select, a picker…). It receives id/aria wiring automatically. */
  children: ReactNode
  /** Helper text under the control (hidden while an error shows). */
  hint?: ReactNode
  /** Error message; marks the control aria-invalid. */
  error?: ReactNode
  /** Adds a red asterisk and `required` on the control. */
  required?: boolean
  /** Explicit control id (auto-generated otherwise). */
  id?: string
  /** Extra element aligned right of the label (e.g. a "Clear" link). */
  labelAside?: ReactNode
  className?: string
}

/** Form field: label + control + hint/error, with accessible wiring. */
export function Field({ label, children, hint, error, required = false, id, labelAside, className }: FieldProps) {
  const autoId = useId()
  const controlId = id ?? `field-${autoId}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [errorId, !error ? hintId : undefined].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={controlId} className="text-xs font-semibold text-fg-muted">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          )}
        </label>
        {labelAside}
      </div>
      <FieldContext value={{ id: controlId, describedBy, invalid: !!error, required }}>{children}</FieldContext>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
