import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { normalizeKey, projectKeyOf } from '@/lib/projectKey'
import { api, seg, type QueryParams } from './client'
import { invalidateProject } from './invalidate'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type {
  CreateIssueInput,
  Issue,
  IssueDetail,
  IssueSearchParams,
  MoveIssueInput,
  Page,
  UpdateIssueInput,
} from './types'

/**
 * Drops empty values (`undefined`, `null`, `''`, `[]`) and trims `q` so equivalent searches
 * share one cache entry.
 */
export function normalizeIssueSearch(params: IssueSearchParams): IssueSearchParams {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    if (typeof value === 'string') {
      const v = value.trim()
      if (v === '') continue
      out[key] = key === 'project' ? v.toUpperCase() : v
      continue
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      out[key] = [...value]
      continue
    }
    out[key] = value
  }
  return out as IssueSearchParams
}

/**
 * GET /issues — search / filtered lists across the caller's projects (SPEC §5 query params).
 * Returns `Page<Issue>`. Pass `placeholderData: keepPreviousData` for paginated tables.
 */
export function useIssues(params: IssueSearchParams, options?: QueryOptions<Page<Issue>>) {
  const clean = normalizeIssueSearch(params)
  return useQuery({
    ...options,
    queryKey: qk.issues(clean),
    queryFn: ({ signal }) => api.get<Page<Issue>>('/issues', clean as QueryParams, { signal }),
  })
}

/** GET /issues/{issueKey} — full issue with children and links. Disabled while key is empty. */
export function useIssue(issueKey: string | null | undefined, options?: QueryOptions<IssueDetail>) {
  return useQuery({
    ...withCondition(!!issueKey, options),
    queryKey: qk.issue(issueKey ?? ''),
    queryFn: ({ signal }) =>
      api.get<IssueDetail>(`/issues/${seg(normalizeKey(issueKey!))}`, undefined, { signal }),
  })
}

/** Variables of {@link useCreateIssue}: the target project plus the CreateIssue body. */
export type CreateIssueVariables = CreateIssueInput & { projectKey: string }

/**
 * POST /projects/{key}/issues → 201 IssueDetail.
 * `createIssue.mutate({ projectKey: 'GB', type: 'task', summary: 'Write docs' })`
 */
export function useCreateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectKey, ...input }: CreateIssueVariables) =>
      api.post<IssueDetail>(`/projects/${seg(normalizeKey(projectKey))}/issues`, input),
    onSuccess: (issue) => {
      qc.setQueryData(qk.issue(issue.key), issue)
      return invalidateProject(qc, issue.projectKey, { projects: true })
    },
  })
}

/**
 * PATCH /issues/{issueKey} — send only changed fields (`null` clears a nullable field,
 * `labelIds` replaces the set). The returned IssueDetail is written to the cache; linked
 * issues (in any project) are refreshed too, as they show its summary and status.
 */
export function useUpdateIssue(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateIssueInput) =>
      api.patch<IssueDetail>(`/issues/${seg(normalizeKey(issueKey))}`, input),
    onSuccess: (issue) => {
      qc.setQueryData(qk.issue(issue.key), issue)
      return invalidateProject(qc, issue.projectKey, { linkedIssues: true })
    },
  })
}

/**
 * DELETE /issues/{issueKey} — variable is the issue key. Subtasks are deleted too.
 * The issue's cached detail/comments/activity are dropped (close any open modal first), and
 * linked issues (in any project) are refreshed so they stop listing it.
 */
export function useDeleteIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (issueKey: string) => api.delete(`/issues/${seg(normalizeKey(issueKey))}`),
    onSuccess: (_data, issueKey) => {
      qc.removeQueries({ queryKey: qk.issue(issueKey) })
      return invalidateProject(qc, projectKeyOf(issueKey), { projects: true, linkedIssues: true })
    },
  })
}

/** Variables of {@link useMoveIssue}. */
export type MoveIssueVariables = MoveIssueInput & { issueKey: string }

/**
 * POST /issues/{issueKey}/move — drag & drop. `{ issueKey, statusId?, sprintId?, prevIssueId?,
 * nextIssueId? }`; omit `sprintId` to keep the sprint, `null` moves to the backlog; neighbours
 * are the issues directly above/below in the destination list. Resolves after the project's
 * active queries refetched, so optimistic UI can be dropped without flicker. Linked issues
 * (in any project) are refreshed too, as they show its status.
 */
export function useMoveIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueKey, ...input }: MoveIssueVariables) => {
      const body: MoveIssueInput = {}
      if (input.statusId !== undefined) body.statusId = input.statusId
      if (input.sprintId !== undefined) body.sprintId = input.sprintId
      if (input.prevIssueId != null) body.prevIssueId = input.prevIssueId
      if (input.nextIssueId != null) body.nextIssueId = input.nextIssueId
      return api.post<Issue>(`/issues/${seg(normalizeKey(issueKey))}/move`, body)
    },
    onSuccess: (issue) => invalidateProject(qc, issue.projectKey, { linkedIssues: true }),
  })
}
