import {
  ArrowRightLeft,
  CirclePlus,
  FolderPlus,
  Link2,
  Link2Off,
  MessageSquare,
  Pencil,
  Play,
  Rocket,
  Trash2,
  UserMinus,
  UserPlus,
  Flag,
  type LucideIcon,
} from 'lucide-react'
import type { Activity } from '@/api/types'
import { dayKey } from '@/lib/dates'

/** Visual marker of an activity row: an icon and the semantic tone of its badge. */
export interface ActivityMarker {
  icon: LucideIcon
  /** Tailwind classes (semantic tokens) for the badge background + icon colour. */
  className: string
  label: string
}

const TONES = {
  success: 'bg-success-subtle text-success',
  info: 'bg-info-subtle text-info',
  danger: 'bg-danger-subtle text-danger',
  primary: 'bg-primary-subtle text-primary',
  neutral: 'bg-neutral-subtle text-neutral',
} as const

/** The badge shown on an activity's avatar: what kind of change it was, at a glance. */
export function activityMarker(activity: Pick<Activity, 'action' | 'field'>): ActivityMarker {
  switch (activity.action) {
    case 'issue.created':
      return { icon: CirclePlus, className: TONES.success, label: 'Created' }
    case 'issue.deleted':
      return { icon: Trash2, className: TONES.danger, label: 'Deleted' }
    case 'comment.created':
      return { icon: MessageSquare, className: TONES.info, label: 'Comment' }
    case 'link.created':
      return { icon: Link2, className: TONES.neutral, label: 'Link added' }
    case 'link.deleted':
      return { icon: Link2Off, className: TONES.neutral, label: 'Link removed' }
    case 'sprint.created':
      return { icon: Flag, className: TONES.primary, label: 'Sprint created' }
    case 'sprint.started':
      return { icon: Play, className: TONES.primary, label: 'Sprint started' }
    case 'sprint.completed':
      return { icon: Rocket, className: TONES.success, label: 'Sprint completed' }
    case 'project.created':
      return { icon: FolderPlus, className: TONES.primary, label: 'Project created' }
    case 'member.added':
      return { icon: UserPlus, className: TONES.neutral, label: 'Member added' }
    case 'member.removed':
      return { icon: UserMinus, className: TONES.neutral, label: 'Member removed' }
    case 'issue.updated':
      return activity.field === 'status' || activity.field === 'sprint'
        ? { icon: ArrowRightLeft, className: TONES.info, label: 'Moved' }
        : { icon: Pencil, className: TONES.neutral, label: 'Updated' }
    default:
      return { icon: Pencil, className: TONES.neutral, label: 'Activity' }
  }
}

/** A calendar day of activity rows (newest day first, rows newest first). */
export interface ActivityDay {
  /** Local `YYYY-MM-DD`. */
  key: string
  /** Timestamp of the first row, for the heading. */
  date: string
  items: Activity[]
}

/** Group newest-first activity rows by local calendar day, dropping duplicate ids. */
export function groupActivityByDay(activities: readonly Activity[]): ActivityDay[] {
  const days: ActivityDay[] = []
  const seen = new Set<number>()
  for (const activity of activities) {
    if (seen.has(activity.id)) continue
    seen.add(activity.id)
    const key = dayKey(activity.createdAt)
    const last = days[days.length - 1]
    if (last && last.key === key) last.items.push(activity)
    else days.push({ key, date: activity.createdAt, items: [activity] })
  }
  return days
}
