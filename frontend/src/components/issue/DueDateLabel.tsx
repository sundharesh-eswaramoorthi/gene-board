import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/cn'
import { daysRemaining, formatDate, formatShortDate } from '@/lib/dates'

/** Props of `DueDateLabel`. */
export interface DueDateLabelProps {
  /** `YYYY-MM-DD` or null. */
  date: string | null | undefined
  /** Resolved issues are never shown as overdue. */
  resolved?: boolean
  /** Compact `Sep 24` (default) or full `Sep 24, 2026`. */
  format?: 'short' | 'long'
  showIcon?: boolean
  /** Text when there's no date (default: render nothing). */
  emptyText?: string
  className?: string
}

/** Due date, coloured red when overdue and amber when due within 2 days. */
export function DueDateLabel({ date, resolved = false, format = 'short', showIcon = true, emptyText, className }: DueDateLabelProps) {
  if (!date) return emptyText ? <span className={cn('text-fg-subtle', className)}>{emptyText}</span> : null
  const days = daysRemaining(date)
  const overdue = !resolved && days != null && days < 0
  const soon = !resolved && days != null && days >= 0 && days <= 2
  const text = format === 'long' ? formatDate(date) : formatShortDate(date)
  return (
    <span
      title={overdue ? `Overdue — due ${formatDate(date)}` : `Due ${formatDate(date)}`}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap',
        overdue ? 'font-medium text-danger' : soon ? 'text-warning' : 'text-fg-muted',
        className,
      )}
    >
      {showIcon && <CalendarDays className="size-3.5 shrink-0" aria-hidden />}
      {text}
    </span>
  )
}
