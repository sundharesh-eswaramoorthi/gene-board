import { matchQuery, type QueryClient } from '@tanstack/react-query'
import { qk } from './queryKeys'

/**
 * Standard post-mutation invalidation (docs/FRONTEND.md §2): everything under
 * `['project', KEY]`, all issue searches and the activity feed — plus the project list when
 * `projects` is set (project data or issue counts changed). Resolves when active queries have
 * refetched, so awaiting a mutation means the cache is fresh.
 */
export function invalidateProject(
  qc: QueryClient,
  projectKey: string | readonly string[],
  { projects = false }: { projects?: boolean } = {},
): Promise<unknown> {
  const keys = Array.from(new Set(typeof projectKey === 'string' ? [projectKey] : projectKey))
  return Promise.all([
    ...keys.map((key) => qc.invalidateQueries({ queryKey: qk.project(key) })),
    qc.invalidateQueries({ queryKey: qk.issues() }),
    qc.invalidateQueries({ queryKey: qk.activityFeed() }),
    projects ? qc.invalidateQueries({ queryKey: qk.projects() }) : undefined,
  ])
}

/** How long {@link forgetProject} keeps dropping a project's queries as its pages unmount. */
const FORGET_WINDOW_MS = 10_000

/**
 * After the caller lost access to a project (deleted it, or left it): forget its cached data
 * without firing requests that would now 404. The project's pages may still be mounted for a
 * moment (navigation away is a transition), so its queries are cancelled and marked stale —
 * not refetched, and not removed while observed (removal would make mounted pages refetch).
 * Queries nothing observes are dropped now; the others are dropped as soon as their last
 * observer detaches, so opening the project again loads afresh (→ "not found") instead of
 * showing stale data. The project list, searches and the activity feed are refreshed. Callers
 * should navigate away from the project.
 */
export function forgetProject(qc: QueryClient, projectKey: string): Promise<unknown> {
  const queryKey = qk.project(projectKey)
  void qc.cancelQueries({ queryKey })
  qc.removeQueries({ queryKey, type: 'inactive' })
  const cache = qc.getQueryCache()
  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== 'observerRemoved' || event.query.getObserversCount() > 0) return
    if (matchQuery({ queryKey }, event.query)) cache.remove(event.query)
  })
  setTimeout(unsubscribe, FORGET_WINDOW_MS)
  return Promise.all([
    qc.invalidateQueries({ queryKey, refetchType: 'none' }),
    qc.invalidateQueries({ queryKey: qk.projects() }),
    qc.invalidateQueries({ queryKey: qk.issues() }),
    qc.invalidateQueries({ queryKey: qk.activityFeed() }),
  ])
}
