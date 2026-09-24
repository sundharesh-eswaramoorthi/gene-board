import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import type { IssueRef, UserSummary } from '@/api/types'
import { IssueTypeIcon, PriorityIcon, StatusLozenge, StoryPointsBadge, UserAvatar } from '@/components/issue'
import { cn } from '@/lib/cn'
import { useIssueView } from './IssueViewContext'

/** Props of `IssueRefLink`. */
export interface IssueRefLinkProps {
  issueKey: string
  children?: ReactNode
  className?: string
  title?: string
  /** Stretch the click target over the nearest `relative` ancestor (whole-row links). */
  stretched?: boolean
}

/**
 * Link to another issue that respects the view: inside the modal a plain click swaps the modal
 * to that issue (`?issue=`); on the full page (and with modifier keys) it goes to `/browse/KEY`.
 */
export function IssueRefLink({ issueKey, children, className, title, stretched = false }: IssueRefLinkProps) {
  const { variant, openIssue } = useIssueView()
  const key = issueKey.toUpperCase()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (variant !== 'modal' || e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    openIssue(key)
  }
  return (
    <Link
      to={`/browse/${key}`}
      title={title}
      onClick={onClick}
      className={cn('rounded-[2px]', stretched && 'after:absolute after:inset-0', className)}
    >
      {children ?? key}
    </Link>
  )
}

/** Props of `IssueRefRow`. */
export interface IssueRefRowProps {
  issue: Pick<IssueRef, 'key' | 'summary' | 'type' | 'status' | 'priority'>
  /** Assignee avatar; `undefined` hides the column (link refs carry no assignee). */
  assignee?: UserSummary | null
  /** Story point pill (shown when not null/undefined). */
  storyPoints?: number | null
  /** Trailing controls (e.g. "Remove link"); they sit above the row-wide link. */
  actions?: ReactNode
}

/** Compact issue row (child issues, linked issues): the whole row opens the issue. */
export function IssueRefRow({ issue, assignee, storyPoints, actions }: IssueRefRowProps) {
  const done = issue.status.category === 'done'
  return (
    <li className="group relative flex min-h-10 items-center gap-2.5 px-3 py-1.5 transition-colors focus-within:bg-surface-hover hover:bg-surface-hover">
      <IssueTypeIcon type={issue.type} />
      <IssueRefLink
        issueKey={issue.key}
        stretched
        title={`${issue.key}: ${issue.summary}`}
        className="flex min-w-0 flex-1 items-baseline gap-2"
      >
        <span className={cn('shrink-0 text-xs font-medium text-fg-muted', done && 'line-through')}>{issue.key}</span>
        <span className="truncate text-sm text-fg">{issue.summary}</span>
      </IssueRefLink>
      <div className="flex shrink-0 items-center gap-2">
        {storyPoints != null && <StoryPointsBadge points={storyPoints} />}
        <PriorityIcon priority={issue.priority} />
        {assignee !== undefined && (
          <span className="relative z-10 flex">
            <UserAvatar user={assignee} size="sm" />
          </span>
        )}
        <StatusLozenge status={issue.status} className="max-w-32" />
        {actions && <span className="relative z-10 flex items-center">{actions}</span>}
      </div>
    </li>
  )
}
