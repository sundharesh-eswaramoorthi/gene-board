import { ChevronDown } from 'lucide-react'
import type { ReactNode, Ref, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { useFieldControl } from './Field'
import { controlClasses } from './Input'

/** Option of the native Select. */
export interface SelectOption {
  value: string | number
  label: string
  disabled?: boolean
}

/** Props of `Select`. */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Options (alternatively pass `<option>` children). */
  options?: readonly SelectOption[]
  /** Adds a first empty option with this text. */
  placeholder?: string
  size?: 'sm' | 'md'
  children?: ReactNode
  ref?: Ref<HTMLSelectElement>
}

/** Native `<select>` styled like an input (best for short, static option lists). */
export function Select({ options, placeholder, size = 'md', className, children, ref, ...rest }: SelectProps) {
  const props = useFieldControl(rest)
  return (
    <div className={cn('relative w-full', className)}>
      <select
        ref={ref}
        className={cn(
          controlClasses,
          'appearance-none pr-8',
          size === 'sm' ? 'h-7 pl-2 text-xs' : 'h-8 pl-2.5 text-sm',
        )}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
    </div>
  )
}
