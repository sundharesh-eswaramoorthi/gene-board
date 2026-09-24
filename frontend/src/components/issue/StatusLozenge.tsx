import type { Status } from '@/api/types'
import { cn } from '@/lib/cn'
import { STATUS_CATEGORY_META } from '@/lib/issueMeta'

/** Props of `StatusLozenge`. */
export interface StatusLozengeProps {
  status: Pick<Status, 'name' | 'category'>
  className?: string
}

/** Uppercase 11px bold status pill coloured by category (grey / blue / green), like Jira. */
export function StatusLozenge({ status, className }: StatusLozengeProps) {
  return (
    <span
      title={status.name}
      className={cn(
        'inline-flex h-5 max-w-44 shrink-0 items-center rounded-[3px] px-1.5 text-2xs font-bold tracking-wide whitespace-nowrap uppercase',
        STATUS_CATEGORY_META[status.category].lozengeClassName,
        className,
      )}
    >
      <span className="truncate">{status.name}</span>
    </span>
  )
}
