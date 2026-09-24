import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'

const VARIANTS = {
  subtle: 'text-fg-muted hover:bg-surface-hover hover:text-fg data-[state=open]:bg-surface-hover data-[state=open]:text-fg',
  secondary: 'border border-border-strong bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  danger: 'text-fg-muted hover:bg-danger-subtle hover:text-danger',
} as const

const SIZES = {
  xs: 'size-6 [&_svg]:size-3.5',
  sm: 'size-7 [&_svg]:size-4',
  md: 'size-8 [&_svg]:size-4',
} as const

/** Props of `IconButton`. */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also shown as tooltip unless `tooltip={false}` or a custom tooltip is given. */
  label: string
  /** The icon element, e.g. `<Trash2 />`. */
  icon: ReactNode
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  tooltip?: ReactNode | false
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** Square icon-only button with an aria-label and a tooltip. Works as a Radix `asChild` trigger. */
export function IconButton({
  label,
  icon,
  variant = 'subtle',
  size = 'md',
  tooltip,
  tooltipSide,
  loading,
  className,
  type,
  disabled,
  ref,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm transition-colors',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="xs" /> : icon}
    </button>
  )
  if (tooltip === false) return button
  return (
    <Tooltip content={tooltip ?? label} side={tooltipSide}>
      {button}
    </Tooltip>
  )
}
