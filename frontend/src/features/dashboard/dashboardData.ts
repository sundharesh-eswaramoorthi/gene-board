import { useIssues } from '@/api/issues'
import type { Issue, IssueSearchParams, Project } from '@/api/types'
import { issueSearchPath } from '@/features/search/issueFilters'

/** Open issues assigned to the caller across all projects, most urgent first. */
export const ASSIGNED_TO_ME: IssueSearchParams = {
  assigneeId: 'me',
  statusCategory: ['todo', 'in_progress'],
  sort: 'priority',
  limit: 100,
}

/** The same search on the issues page (shareable, with every filter visible). */
export const ASSIGNED_TO_ME_PATH = issueSearchPath({
  assignees: ['me'],
  categories: ['todo', 'in_progress'],
  sort: 'priority',
  order: 'asc',
})

/** `GET /issues` for {@link ASSIGNED_TO_ME} (one cache entry shared by the dashboard widgets). */
export function useAssignedToMe() {
  return useIssues(ASSIGNED_TO_ME)
}

/** Assigned issues of one project. */
export interface ProjectIssueGroup {
  projectKey: string
  project: Project | undefined
  issues: Issue[]
}

/**
 * Group issues by project, keeping each group's priority order. Groups are ordered by project
 * name so the list stays put as priorities change.
 */
export function groupByProject(issues: readonly Issue[], projects: readonly Project[] | undefined): ProjectIssueGroup[] {
  const byKey = new Map((projects ?? []).map((p) => [p.key, p]))
  const groups = new Map<string, ProjectIssueGroup>()
  for (const issue of issues) {
    let group = groups.get(issue.projectKey)
    if (!group) {
      group = { projectKey: issue.projectKey, project: byKey.get(issue.projectKey), issues: [] }
      groups.set(issue.projectKey, group)
    }
    group.issues.push(issue)
  }
  return [...groups.values()].sort((a, b) =>
    (a.project?.name ?? a.projectKey).localeCompare(b.project?.name ?? b.projectKey),
  )
}

/**
 * Projects for the "Recent projects" cards: the ones visited recently in this browser first
 * (most recent first), then the rest by name.
 */
export function orderRecentProjects(projects: readonly Project[], recentKeys: readonly string[], max: number): Project[] {
  const byKey = new Map(projects.map((p) => [p.key, p]))
  const recent = recentKeys.map((k) => byKey.get(k)).filter((p): p is Project => p !== undefined)
  const rest = projects.filter((p) => !recentKeys.includes(p.key))
  return [...recent, ...rest].slice(0, max)
}

/** "Good morning" / "Good afternoon" / "Good evening" for the local time. */
export function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Good evening'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
