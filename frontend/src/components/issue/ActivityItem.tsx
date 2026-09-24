import type { ReactNode } from 'react'
import type { Activity } from '@/api/types'
import { Tooltip } from '@/components/ui/Tooltip'
import { describeActivity } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { formatDateTime, formatRelative } from '@/lib/dates'
import { truncate } from '@/lib/format'
import { IssueKeyLink } from './IssueKeyLink'
import { UserAvatar } from './UserAvatar'

/** Props of `ActivityItem`. */
export interface ActivityItemProps {
  activity: Activity
  /** Mention (and link) the issue key — for project / cross-project feeds. Default false. */
  withIssue?: boolean
  /** Show the project key chip before the time (cross-project feed). Default false. */
  showProject?: boolean
  /** Hide the avatar column. */
  hideAvatar?: boolean
  className?: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Turns every whole occurrence of `key` into a link ("GB-2" never matches inside "GB-20"). */
function linkKeys(text: string, key: string | null, deleted: boolean): ReactNode {
  if (!key || deleted) return text
  const parts = text.split(new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(key)}(?![0-9])`))
  if (parts.length === 1) return text
  return parts.flatMap((part, i) =>
    i === 0 ? [part] : [<IssueKeyLink key={i} issueKey={key} className="font-semibold" />, part],
  )
}

/**
 * One activity row: avatar, "**Alex** changed Status from To Do to In Progress", relative time
 * (full timestamp on hover) and, for comments, a short excerpt. Issue keys are links that open
 * the issue modal.
 */
export function ActivityItem({ activity, withIssue = false, showProject = false, hideAvatar = false, className }: ActivityItemProps) {
  const sentence = describeActivity(activity, { withIssue })
  // Deleted issues keep their key in history but have no page to link to.
  const deleted = activity.action === 'issue.deleted' || activity.issueId == null
  const excerpt = activity.action === 'comment.created' && activity.newValue ? truncate(activity.newValue, 160) : null
  return (
    <div className={cn('flex gap-3', className)}>
      {!hideAvatar && <UserAvatar user={activity.actor} size="lg" emptyLabel="Deleted user" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 text-fg">
          <span className="font-semibold">{activity.actor?.name ?? 'Someone'}</span>{' '}
          <span className="text-fg-muted">{linkKeys(sentence, activity.issueKey, deleted)}</span>
        </p>
        {excerpt && (
          <p className="mt-1 line-clamp-2 border-l-2 border-border-strong pl-2 text-sm text-fg-muted">{excerpt}</p>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
          {showProject && <span className="font-medium">{activity.projectKey}</span>}
          <Tooltip content={formatDateTime(activity.createdAt)}>
            <time dateTime={activity.createdAt} tabIndex={-1}>
              {formatRelative(activity.createdAt)}
            </time>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
