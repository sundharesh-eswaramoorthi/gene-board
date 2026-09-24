import {
  Bookmark,
  Bug,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Equal,
  ListChecks,
  SquareCheck,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type {
  Issue,
  IssueType,
  LinkType,
  Priority,
  ProjectType,
  Role,
  SprintState,
  StatusCategory,
} from '@/api/types'

// ---------------------------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------------------------

/** Display metadata of an issue type. */
export interface IssueTypeMeta {
  value: IssueType
  label: string
  /** fixed brand colour (same in both themes) */
  color: string
  icon: LucideIcon
  description: string
}

/** Display metadata per issue type (fixed brand colours from docs/FRONTEND.md §1). */
export const ISSUE_TYPE_META: Record<IssueType, IssueTypeMeta> = {
  epic: {
    value: 'epic',
    label: 'Epic',
    color: '#904EE2',
    icon: Zap,
    description: 'A large body of work broken down into stories, tasks and bugs.',
  },
  story: {
    value: 'story',
    label: 'Story',
    color: '#63BA3C',
    icon: Bookmark,
    description: 'A feature expressed from the user’s point of view.',
  },
  task: {
    value: 'task',
    label: 'Task',
    color: '#4BADE8',
    icon: SquareCheck,
    description: 'A piece of work that needs to be done.',
  },
  bug: {
    value: 'bug',
    label: 'Bug',
    color: '#E5493A',
    icon: Bug,
    description: 'A problem that impairs or prevents functionality.',
  },
  subtask: {
    value: 'subtask',
    label: 'Subtask',
    color: '#4BADE8',
    icon: ListChecks,
    description: 'A smaller piece of work within a story, task or bug.',
  },
}

/** All issue types in display order. */
export const ISSUE_TYPES: readonly IssueType[] = ['epic', 'story', 'task', 'bug', 'subtask']

/** Story / task / bug — the types that live on boards, backlog and sprints. */
export const STANDARD_ISSUE_TYPES: readonly IssueType[] = ['story', 'task', 'bug']

/** True for story / task / bug. */
export function isStandardType(type: IssueType): boolean {
  return type === 'story' || type === 'task' || type === 'bug'
}

/**
 * Parent types allowed for a child type: standard issues → epic, subtask → standard issue,
 * epic → none.
 */
export function allowedParentTypes(childType: IssueType): IssueType[] {
  if (childType === 'subtask') return ['story', 'task', 'bug']
  if (isStandardType(childType)) return ['epic']
  return []
}

/** Types a child created under `parentType` may have (epic → standard types, standard → subtask). */
export function allowedChildTypes(parentType: IssueType): IssueType[] {
  if (parentType === 'epic') return ['story', 'task', 'bug']
  if (isStandardType(parentType)) return ['subtask']
  return []
}

/** Types an issue can be changed to (type changes are only allowed among story/task/bug). */
export function allowedTypeChanges(current: IssueType): IssueType[] {
  return isStandardType(current) ? ['story', 'task', 'bug'] : [current]
}

// ---------------------------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------------------------

/** Display metadata of a priority. */
export interface PriorityMeta {
  value: Priority
  label: string
  color: string
  icon: LucideIcon
  /** 0 = highest … 4 = lowest */
  order: number
}

/** Display metadata per priority (fixed brand colours). */
export const PRIORITY_META: Record<Priority, PriorityMeta> = {
  highest: { value: 'highest', label: 'Highest', color: '#CD1317', icon: ChevronsUp, order: 0 },
  high: { value: 'high', label: 'High', color: '#E9494A', icon: ChevronUp, order: 1 },
  medium: { value: 'medium', label: 'Medium', color: '#E97F33', icon: Equal, order: 2 },
  low: { value: 'low', label: 'Low', color: '#2D8738', icon: ChevronDown, order: 3 },
  lowest: { value: 'lowest', label: 'Lowest', color: '#57A55A', icon: ChevronsDown, order: 4 },
}

/** Priorities from highest to lowest. */
export const PRIORITIES: readonly Priority[] = ['highest', 'high', 'medium', 'low', 'lowest']

/** Sort comparator: highest priority first. */
export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_META[a].order - PRIORITY_META[b].order
}

// ---------------------------------------------------------------------------------------------
// Status categories
// ---------------------------------------------------------------------------------------------

/** Display metadata of a status category. */
export interface StatusCategoryMeta {
  value: StatusCategory
  label: string
  /** Tailwind classes (semantic tokens) for the lozenge: grey / blue / green. */
  lozengeClassName: string
  /** Tailwind classes for a solid dot / bar segment of this category. */
  dotClassName: string
  /** Tailwind text colour class for the category. */
  textClassName: string
  order: number
}

/** Display metadata per status category (todo grey, in progress blue, done green). */
export const STATUS_CATEGORY_META: Record<StatusCategory, StatusCategoryMeta> = {
  todo: {
    value: 'todo',
    label: 'To Do',
    lozengeClassName: 'bg-neutral-subtle text-neutral',
    dotClassName: 'bg-neutral',
    textClassName: 'text-neutral',
    order: 0,
  },
  in_progress: {
    value: 'in_progress',
    label: 'In Progress',
    lozengeClassName: 'bg-info-subtle text-info',
    dotClassName: 'bg-info',
    textClassName: 'text-info',
    order: 1,
  },
  done: {
    value: 'done',
    label: 'Done',
    lozengeClassName: 'bg-success-subtle text-success',
    dotClassName: 'bg-success',
    textClassName: 'text-success',
    order: 2,
  },
}

/** Status categories in workflow order. */
export const STATUS_CATEGORIES: readonly StatusCategory[] = ['todo', 'in_progress', 'done']

// ---------------------------------------------------------------------------------------------
// Links, sprints, roles, project types
// ---------------------------------------------------------------------------------------------

/** Outward / inward labels of a link type. */
export interface LinkTypeMeta {
  value: LinkType
  /** label from the source issue's perspective */
  outward: string
  /** label from the target issue's perspective */
  inward: string
}

/** Link type labels (SPEC §4 IssueLink.label). */
export const LINK_TYPE_META: Record<LinkType, LinkTypeMeta> = {
  blocks: { value: 'blocks', outward: 'blocks', inward: 'is blocked by' },
  relates: { value: 'relates', outward: 'relates to', inward: 'relates to' },
  duplicates: { value: 'duplicates', outward: 'duplicates', inward: 'is duplicated by' },
  clones: { value: 'clones', outward: 'clones', inward: 'is cloned by' },
}

/** Link types in menu order. */
export const LINK_TYPES: readonly LinkType[] = ['blocks', 'relates', 'duplicates', 'clones']

/** Label + lozenge classes per sprint state. */
export const SPRINT_STATE_META: Record<SprintState, { label: string; lozengeClassName: string }> = {
  planned: { label: 'Planned', lozengeClassName: 'bg-neutral-subtle text-neutral' },
  active: { label: 'Active', lozengeClassName: 'bg-info-subtle text-info' },
  completed: { label: 'Completed', lozengeClassName: 'bg-success-subtle text-success' },
}

/** Label + description per project role. */
export const ROLE_META: Record<Role, { label: string; description: string }> = {
  admin: {
    label: 'Admin',
    description: 'Full control: settings, members, columns and labels.',
  },
  member: {
    label: 'Member',
    description: 'Create, edit and move issues; manage sprints.',
  },
  viewer: { label: 'Viewer', description: 'Read-only access to the project.' },
}

/** Roles from most to least privileged. */
export const ROLES: readonly Role[] = ['admin', 'member', 'viewer']

/** Label + description per project type (Create project dialog). */
export const PROJECT_TYPE_META: Record<ProjectType, { label: string; description: string }> = {
  scrum: {
    label: 'Scrum',
    description: 'Plan work in sprints from a backlog; the board shows the active sprint.',
  },
  kanban: {
    label: 'Kanban',
    description: 'Visualise a continuous flow of work on a board with WIP limits.',
  },
}

// ---------------------------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------------------------

/** Byte-wise rank comparator (matches the server's `COLLATE "C"`), ties by id. */
export function compareRank(a: Pick<Issue, 'rank' | 'id'>, b: Pick<Issue, 'rank' | 'id'>): number {
  if (a.rank < b.rank) return -1
  if (a.rank > b.rank) return 1
  return a.id - b.id
}

/** Returns a new array sorted by rank. */
export function sortByRank<T extends Pick<Issue, 'rank' | 'id'>>(issues: readonly T[]): T[] {
  return [...issues].sort(compareRank)
}

/** Numeric part of an issue key (`GB-12` → 12), for natural key sorting. */
export function issueNumber(key: string): number {
  const n = Number(key.slice(key.lastIndexOf('-') + 1))
  return Number.isFinite(n) ? n : 0
}

/** True when the issue's status is in the done category. */
export function isDone(issue: { status: { category: StatusCategory } }): boolean {
  return issue.status.category === 'done'
}

/** Format story points for display (`3`, `0.5`, `—` for null). */
export function formatPoints(points: number | null | undefined, empty = '—'): string {
  if (points == null) return empty
  return Number.isInteger(points) ? String(points) : String(Math.round(points * 10) / 10)
}
