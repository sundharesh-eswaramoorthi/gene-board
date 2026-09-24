import type { Priority } from '@/api/types'
import { cn } from '@/lib/cn'
import { PRIORITY_META } from '@/lib/issueMeta'

/** Props of `PriorityIcon`. */
export interface PriorityIconProps {
  priority: Priority
  size?: 'sm' | 'md'
  /** Render the label next to the icon. */
  showLabel?: boolean
  className?: string
}

/** Coloured chevron/equal icon for a priority (optionally with its label). */
export function PriorityIcon({ priority, size = 'md', showLabel = false, className }: PriorityIconProps) {
  const meta = PRIORITY_META[priority]
  const Icon = meta.icon
  const icon = (
    <Icon
      aria-hidden
      className={cn('shrink-0', size === 'sm' ? 'size-3.5' : 'size-4')}
      style={{ color: meta.color }}
      strokeWidth={2.5}
    />
  )
  if (showLabel) {
    return (
      // align-middle: an inline-flex box whose first item is an svg would otherwise sit on the
      // text baseline by the icon's bottom edge, riding a few pixels above neighbouring text.
      <span className={cn('inline-flex min-w-0 items-center gap-1.5 align-middle', className)}>
        {icon}
        <span className="truncate">{meta.label}</span>
      </span>
    )
  }
  return (
    <span
      role="img"
      aria-label={`${meta.label} priority`}
      title={`${meta.label} priority`}
      className={cn('inline-flex shrink-0', className)}
    >
      {icon}
    </span>
  )
}
