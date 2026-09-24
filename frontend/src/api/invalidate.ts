import { matchQuery, type QueryClient, type QueryFilters, type QueryKey } from '@tanstack/react-query'
import { normalizeKey } from '@/lib/projectKey'
import { qk } from './queryKeys'

/** Options of {@link invalidateProject} and {@link refreshProject}. */
export interface InvalidateOptions {
  /** Also the project list (project data or issue counts changed). */
  projects?: boolean
  /**
   * Also the issue details of every other project: an issue's summary, status or existence
   * changed, and the issues linked to it (links can cross projects) show those.
   */
  linkedIssues?: boolean
}

/** `['project', KEY, 'issue', ISSUE-KEY]` (not its comments or activity). */
function isIssueDetailKey(queryKey: QueryKey): boolean {
  return queryKey.length === 4 && queryKey[0] === 'project' && queryKey[2] === 'issue'
}

/** The issue details of every project but the given ones (normalized keys). */
function otherIssueDetails(keys: ReadonlySet<string>): QueryFilters {
  return { predicate: ({ queryKey }) => isIssueDetailKey(queryKey) && !keys.has(queryKey[1] as string) }
}

/** The queries a change in the given projects can make stale (see {@link invalidateProject}). */
function staleQueries(
  projectKeys: readonly string[],
  { projects = false, linkedIssues = false }: InvalidateOptions,
): QueryFilters[] {
  const keys = new Set(projectKeys.map(normalizeKey))
  const filters: QueryFilters[] = [...keys].map((key) => ({ queryKey: qk.project(key) }))
  filters.push({ queryKey: qk.issues() }, { queryKey: qk.activityFeed() })
  if (projects) filters.push({ queryKey: qk.projects() })
  if (linkedIssues) {
    // The given projects' own issue details are covered above: matching them twice would
    // cancel the refetch the first filter started.
    filters.push(otherIssueDetails(keys))
  }
  return filters
}

/**
 * Standard post-mutation invalidation (docs/FRONTEND.md §2): everything under
 * `['project', KEY]`, all issue searches and the activity feed — plus the project list and
 * other projects' issue details as {@link InvalidateOptions} says. Resolves when active
 * queries have refetched, so awaiting a mutation means the cache is fresh.
 */
export function invalidateProject(
  qc: QueryClient,
  projectKey: string | readonly string[],
  options: InvalidateOptions = {},
): Promise<unknown> {
  const keys = typeof projectKey === 'string' ? [projectKey] : projectKey
  return Promise.all(staleQueries(keys, options).map((filters) => qc.invalidateQueries(filters)))
}

/**
 * The realtime counterpart of {@link invalidateProject}: the same queries, but a refetch
 * that is already running is never cancelled. Otherwise, on a busy project over a slow link,
 * every event would restart the board/backlog download and none would ever finish. A refetch
 * that was already running may predate the change, so those queries are refetched once more
 * after it settles (any refetch running by then started after this call, so it is fresh).
 */
export async function refreshProject(
  qc: QueryClient,
  projectKey: string,
  options: InvalidateOptions = {},
): Promise<void> {
  const filters = staleQueries([projectKey], options)
  const cache = qc.getQueryCache()
  const running = new Set(filters.flatMap((f) => cache.findAll({ ...f, type: 'active', fetchStatus: 'fetching' })))
  await Promise.all(filters.map((f) => qc.invalidateQueries(f, { cancelRefetch: false })))
  if (running.size > 0) {
    await qc.invalidateQueries({ predicate: (query) => running.has(query) }, { cancelRefetch: false })
  }
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
 * showing stale data. The project list, searches, the activity feed and other projects' issue
 * details (their links to its issues may be gone) are refreshed. Callers should navigate away
 * from the project.
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
    qc.invalidateQueries(otherIssueDetails(new Set([queryKey[1]]))),
  ])
}
