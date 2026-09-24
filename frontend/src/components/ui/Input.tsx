import { Search, X } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { charLimitProps } from '@/lib/chars'
import { cn } from '@/lib/cn'
import { useFieldControl } from './Field'

/** Shared look of text-like controls (Input, Textarea, Select, picker "field" triggers). */
export const controlClasses = cn(
  'w-full rounded-sm border border-border-strong bg-surface text-fg transition-[border-color,box-shadow]',
  'placeholder:text-fg-subtle hover:border-fg-subtle',
  'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-subtle disabled:hover:border-border-strong',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/25',
)

const INPUT_SIZES = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-2.5 text-sm',
  lg: 'h-10 px-3 text-sm',
} as const

/** Props of `Input`. */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: keyof typeof INPUT_SIZES
  /** Icon inside the left edge. */
  leadingIcon?: ReactNode
  /** Element inside the right edge (e.g. a unit or clear button). */
  trailing?: ReactNode
  /** Longest value in characters, as the API counts them (an emoji is one, unlike the native attribute). */
  maxLength?: number
  ref?: Ref<HTMLInputElement>
}

/** Text input (also for date/number/email/password). Inside a Field it is auto-labelled. */
export function Input({ size = 'md', leadingIcon, trailing, className, ref, maxLength, onChange, ...rest }: InputProps) {
  const props = useFieldControl(rest)
  const input = (
    <input
      ref={ref}
      className={cn(
        controlClasses,
        INPUT_SIZES[size],
        !!leadingIcon && (size === 'sm' ? 'pl-7' : 'pl-8'),
        !!trailing && 'pr-8',
        !leadingIcon && !trailing && className,
      )}
      {...props}
      {...charLimitProps(maxLength, rest.value, onChange, rest)}
    />
  )
  if (!leadingIcon && !trailing) return input
  return (
    <div className={cn('relative flex w-full items-center', className)}>
      {leadingIcon && (
        <span className="pointer-events-none absolute left-2.5 flex text-fg-subtle [&_svg]:size-4">{leadingIcon}</span>
      )}
      {input}
      {trailing && <span className="absolute right-1.5 flex items-center">{trailing}</span>}
    </div>
  )
}

/** Props of `SearchInput`. */
export interface SearchInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'leadingIcon' | 'trailing'> {
  value: string
  onChange: (value: string) => void
  /** Called when the clear (×) button is pressed; defaults to `onChange('')`. */
  onClear?: () => void
}

/** Search box with magnifier icon and a clear button; Escape clears. */
export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = 'Search',
  onKeyDown,
  className,
  ...props
}: SearchInputProps) {
  const clear = () => (onClear ? onClear() : onChange(''))
  return (
    <Input
      type="search"
      role="searchbox"
      value={value}
      placeholder={placeholder}
      aria-label={props['aria-label'] ?? placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.stopPropagation()
          clear()
        }
        onKeyDown?.(e)
      }}
      leadingIcon={<Search />}
      trailing={
        value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="flex size-5 items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-hover hover:text-fg [&_svg]:size-3.5"
          >
            <X />
          </button>
        ) : undefined
      }
      className={cn('[&_input::-webkit-search-cancel-button]:appearance-none', className)}
      {...props}
    />
  )
}
