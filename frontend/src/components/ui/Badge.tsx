import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Semantic colour of a Badge. */
export type BadgeTone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger'

const SUBTLE: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-subtle text-neutral',
  primary: 'bg-primary-subtle text-primary',
  info: 'bg-info-subtle text-info',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
}

const SOLID: Record<BadgeTone, string> = {
  neutral: 'bg-neutral text-surface',
  primary: 'bg-primary text-primary-fg',
  info: 'bg-info text-surface',
  success: 'bg-success text-surface',
  warning: 'bg-warning text-surface',
  danger: 'bg-danger text-danger-fg',
}

/** Props of `Badge`. */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** `subtle` (tinted, default), `solid`, or `outline`. */
  variant?: 'subtle' | 'solid' | 'outline'
  /** `pill` (rounded-full, for counts/points) or `square` (4px). */
  shape?: 'pill' | 'square'
  size?: 'sm' | 'md'
}

/** Small count / status pill: `<Badge tone="danger">3</Badge>`. */
export function Badge({ tone = 'neutral', variant = 'subtle', shape = 'pill', size = 'sm', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 font-semibold whitespace-nowrap tabular-nums',
        size === 'sm' ? 'h-5 min-w-5 px-1.5 text-2xs' : 'h-6 min-w-6 px-2 text-xs',
        shape === 'pill' ? 'rounded-full' : 'rounded-sm',
        variant === 'subtle' && SUBTLE[tone],
        variant === 'solid' && SOLID[tone],
        variant === 'outline' && 'border border-border-strong text-fg-muted',
        className,
      )}
      {...props}
    />
  )
}
