import type { IssueType } from '@/api/types'
import { cn } from '@/lib/cn'
import { ISSUE_TYPE_META } from '@/lib/issueMeta'

const SIZES = {
  sm: { box: 'size-3.5 rounded-[3px]', icon: 'size-2.5' },
  md: { box: 'size-4 rounded-[3px]', icon: 'size-3' },
  lg: { box: 'size-5 rounded-[4px]', icon: 'size-3.5' },
} as const

/** Props of `IssueTypeIcon`. */
export interface IssueTypeIconProps {
  type: IssueType
  size?: keyof typeof SIZES
  className?: string
  /** Show the type name as a native tooltip (default true). */
  title?: boolean
}

/** Jira-style issue type glyph: white icon on a rounded square of the type's brand colour. */
export function IssueTypeIcon({ type, size = 'md', className, title = true }: IssueTypeIconProps) {
  const meta = ISSUE_TYPE_META[type]
  const Icon = meta.icon
  const s = SIZES[size]
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={title ? meta.label : undefined}
      className={cn('inline-flex shrink-0 items-center justify-center', s.box, className)}
      style={{ backgroundColor: meta.color }}
    >
      <Icon className={cn(s.icon, 'text-white')} strokeWidth={2.75} aria-hidden />
    </span>
  )
}
