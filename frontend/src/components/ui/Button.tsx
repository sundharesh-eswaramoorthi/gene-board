import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

/** Button look. */
export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger' | 'link'
/** Button height preset (28 / 32 / 40px). */
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-xs',
  secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-hover shadow-xs',
  subtle: 'text-fg-muted hover:bg-surface-hover hover:text-fg data-[state=open]:bg-surface-hover',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover shadow-xs',
  link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1 [&_svg]:size-3.5',
  md: 'h-8 px-3 text-sm gap-1.5 [&_svg]:size-4',
  lg: 'h-10 px-4 text-sm gap-2 [&_svg]:size-4',
}

/**
 * Class names for a button look — use on links: `<Link className={buttonClasses({ variant: 'secondary' })}>`.
 */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}): string {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:shrink-0',
    SIZES[size],
    VARIANTS[variant],
    fullWidth && 'w-full',
    className,
  )
}

/** Props of `Button`. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean
  /** Icon before the label (replaced by the spinner while loading). */
  icon?: ReactNode
  /** Icon after the label. */
  iconRight?: ReactNode
  fullWidth?: boolean
  /** Render the child element (e.g. a router `<Link>`) with button styling. */
  asChild?: boolean
  ref?: Ref<HTMLButtonElement>
}

/**
 * Button — variants `primary | secondary | subtle | danger | link`, sizes `sm | md | lg`.
 * `type` defaults to "button" (pass `type="submit"` in forms).
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  fullWidth,
  asChild,
  className,
  disabled,
  children,
  type,
  ref,
  ...props
}: ButtonProps) {
  const classes = buttonClasses({ variant, size, fullWidth, className })
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={size === 'sm' ? 'xs' : 'sm'} label="Working" /> : icon}
      {children}
      {iconRight}
    </button>
  )
}
