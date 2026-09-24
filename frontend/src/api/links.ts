import { useMutation, useQueryClient } from '@tanstack/react-query'
import { normalizeKey, projectKeyOf } from '@/lib/projectKey'
import { api, seg } from './client'
import { invalidateProject } from './invalidate'
import type { CreateLinkInput, ID, IssueLink } from './types'

/**
 * POST /issues/{issueKey}/links — `{ type, targetKey }` → IssueLink (outward, from issueKey's
 * perspective). 409 for a duplicate link. Refreshes both issues' projects.
 */
export function useCreateLink(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLinkInput) =>
      api.post<IssueLink>(`/issues/${seg(normalizeKey(issueKey))}/links`, {
        ...input,
        targetKey: normalizeKey(input.targetKey),
      }),
    onSuccess: (_link, input) =>
      invalidateProject(qc, [projectKeyOf(issueKey), projectKeyOf(input.targetKey)]),
  })
}

/**
 * DELETE /issue-links/{id}. Pass the IssueLink (preferred — also refreshes the other issue's
 * project) or just its id.
 */
export function useDeleteLink(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (link: IssueLink | ID) => api.delete(`/issue-links/${typeof link === 'number' ? link : link.id}`),
    onSuccess: (_data, link) =>
      invalidateProject(
        qc,
        typeof link === 'number'
          ? [projectKeyOf(issueKey)]
          : [projectKeyOf(issueKey), projectKeyOf(link.issue.key)],
      ),
  })
}
