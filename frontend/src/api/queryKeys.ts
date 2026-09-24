import { normalizeKey, projectKeyOf } from '@/lib/projectKey'
import type { IssueSearchParams, SprintState } from './types'

/**
 * TanStack Query key factory. Everything project-scoped lives under `['project', KEY, ...]`
 * so `invalidateQueries({ queryKey: qk.project(KEY) })` refreshes the whole project.
 * Keys are upper-cased, so `qk.board('gb')` and `qk.board('GB')` are the same cache entry.
 */
export const qk = {
  /** `['me']` */
  me: () => ['me'] as const,
  /** `['users', query]` */
  users: (query: string) => ['users', query] as const,
  /** `['projects']` — the caller's project list */
  projects: () => ['projects'] as const,
  /** `['project', KEY]` — the project itself AND the prefix of all project-scoped data */
  project: (key: string) => ['project', normalizeKey(key)] as const,
  /** `['project', KEY, 'board']` */
  board: (key: string) => [...qk.project(key), 'board'] as const,
  /** `['project', KEY, 'backlog']` */
  backlog: (key: string) => [...qk.project(key), 'backlog'] as const,
  /** `['project', KEY, 'epics']` */
  epics: (key: string) => [...qk.project(key), 'epics'] as const,
  /** `['project', KEY, 'statuses']` */
  statuses: (key: string) => [...qk.project(key), 'statuses'] as const,
  /** `['project', KEY, 'labels']` */
  labels: (key: string) => [...qk.project(key), 'labels'] as const,
  /** `['project', KEY, 'members']` */
  members: (key: string) => [...qk.project(key), 'members'] as const,
  /** `['project', KEY, 'sprints']`, or `[..., 'planned,active']` when filtered by state */
  sprints: (key: string, states?: readonly SprintState[]) =>
    states && states.length > 0
      ? ([...qk.project(key), 'sprints', [...states].sort().join(',')] as const)
      : ([...qk.project(key), 'sprints'] as const),
  /** `['project', KEY, 'activity']` */
  projectActivity: (key: string) => [...qk.project(key), 'activity'] as const,
  /** `['project', projectKeyOf(issueKey), 'issue', ISSUE-KEY]` */
  issue: (issueKey: string) =>
    [...qk.project(projectKeyOf(issueKey)), 'issue', normalizeKey(issueKey)] as const,
  /** `[...qk.issue(issueKey), 'comments']` */
  comments: (issueKey: string) => [...qk.issue(issueKey), 'comments'] as const,
  /** `[...qk.issue(issueKey), 'activity']` */
  issueActivity: (issueKey: string) => [...qk.issue(issueKey), 'activity'] as const,
  /** `['issues', params]` — search / lists (GET /issues) */
  issues: (params?: IssueSearchParams) =>
    (params ? (['issues', params] as const) : (['issues'] as const)),
  /** `['activity']` — cross-project feed */
  activityFeed: () => ['activity'] as const,
}
