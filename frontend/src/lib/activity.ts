import type { Activity } from '@/api/types'
import { formatDate } from './dates'

/** Human names of `issue.updated` fields. */
export const ACTIVITY_FIELD_LABELS: Record<string, string> = {
  summary: 'Summary',
  description: 'Description',
  type: 'Type',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  reporter: 'Reporter',
  parent: 'Parent',
  sprint: 'Sprint',
  storyPoints: 'Story points',
  dueDate: 'Due date',
  labels: 'Labels',
}

/** Options of describeActivity. */
export interface DescribeActivityOptions {
  /**
   * Mention the issue key in the sentence ("changed Status of GB-12 from …") — for project and
   * cross-project feeds. Default false (issue history, where the issue is implied).
   */
  withIssue?: boolean
}

const blank = (v: string | null | undefined): v is null | undefined | '' => v == null || v.trim() === ''

function formatValue(field: string | null, value: string): string {
  if (field === 'dueDate') return formatDate(value, value)
  if (field === 'type' || field === 'priority') return value.charAt(0).toUpperCase() + value.slice(1)
  return value
}

function quoted(field: string | null, value: string): string {
  return field === 'summary' ? `“${value}”` : value
}

/**
 * Readable sentence for an activity row, *without* the actor (render the actor's name before
 * it): "changed Status from To Do to In Progress", "created the issue", "added a comment",
 * "started sprint GB Sprint 2". Pass `{ withIssue: true }` to include the issue key.
 */
export function describeActivity(activity: Activity, options: DescribeActivityOptions = {}): string {
  const { action, field, oldValue, newValue } = activity
  const key = activity.issueKey ?? 'an issue'
  const withIssue = options.withIssue ?? false
  const subject = withIssue ? key : 'the issue'
  const of = withIssue ? ` of ${key}` : ''
  const on = withIssue ? ` on ${key}` : ''

  switch (action) {
    case 'issue.created':
      return withIssue ? `created ${key}${blank(newValue) ? '' : ` “${newValue}”`}` : 'created the issue'
    case 'issue.deleted':
      return `deleted ${activity.issueKey ?? 'an issue'}${blank(newValue) ? '' : ` “${newValue}”`}`
    case 'comment.created':
      return withIssue ? `commented on ${key}` : 'added a comment'
    case 'link.created':
      return blank(newValue) ? `added a link${on}` : withIssue ? `linked ${key} ${newValue}` : `added link: ${newValue}`
    case 'link.deleted':
      return blank(newValue) ? `removed a link${on}` : withIssue ? `unlinked ${key} ${newValue}` : `removed link: ${newValue}`
    case 'sprint.created':
      return `created sprint ${newValue ?? ''}`.trim()
    case 'sprint.started':
      return `started sprint ${newValue ?? ''}`.trim()
    case 'sprint.completed':
      return `completed sprint ${newValue ?? ''}`.trim()
    case 'project.created':
      return blank(newValue) ? 'created the project' : `created the project ${newValue}`
    case 'member.added':
      return blank(newValue) ? 'added a member to the project' : `added ${newValue} to the project`
    case 'member.removed':
      if (blank(newValue)) return 'removed a member from the project'
      // Members may remove themselves (leave); the row then names the actor as the removed user.
      return newValue === activity.actor?.name ? 'left the project' : `removed ${newValue} from the project`
    case 'issue.updated':
      break
    default:
      return action.replace(/[._]/g, ' ')
  }

  // issue.updated — one row per changed field
  const label = ACTIVITY_FIELD_LABELS[field ?? ''] ?? field ?? 'a field'
  const from = blank(oldValue) ? null : quoted(field, formatValue(field, oldValue))
  const to = blank(newValue) ? null : quoted(field, formatValue(field, newValue))

  switch (field) {
    case 'description':
      return `updated the Description${of}`
    case 'assignee':
      if (!to) return from ? `unassigned ${from} from ${subject}` : `unassigned ${subject}`
      return from ? `reassigned ${subject} from ${from} to ${to}` : `assigned ${subject} to ${to}`
    case 'sprint':
      if (!to) return from ? `moved ${subject} from ${from} to the backlog` : `moved ${subject} to the backlog`
      return from ? `moved ${subject} from ${from} to ${to}` : `moved ${subject} to ${to}`
    case 'parent':
      if (!to) return from ? `removed ${subject} from ${from}` : `removed the parent${of}`
      return from ? `moved ${subject} from ${from} to ${to}` : `added ${subject} to ${to}`
    case 'labels':
      if (!to) return `removed all Labels${of}`
      if (!from) return `set Labels${of} to ${to}`
      return `changed Labels${of} from ${from} to ${to}`
  }

  if (from && to) return `changed ${label}${of} from ${from} to ${to}`
  if (to) return `set ${label}${of} to ${to}`
  if (from) return `cleared ${label}${of} (was ${from})`
  return `updated ${label}${of}`
}

/** Full sentence including the actor: "Alex Morgan changed Status from To Do to In Progress". */
export function activitySentence(activity: Activity, options?: DescribeActivityOptions): string {
  return `${activity.actor?.name ?? 'Someone'} ${describeActivity(activity, options)}`
}
