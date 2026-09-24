import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, seg } from '@/api/client'
import { invalidateProject } from '@/api/invalidate'
import type { CreateLinkInput, IssueLink, LinkDirection, LinkType } from '@/api/types'
import { normalizeKey, projectKeyOf } from '@/lib/projectKey'

/** Variables of {@link useLinkIssue}. */
export interface LinkIssueVariables {
  type: LinkType
  /**
   * `outward`: "<this> blocks <target>"; `inward`: "<this> is blocked by <target>", which the
   * API stores as "<target> blocks <this>" (created from the target's side).
   */
  direction: LinkDirection
  targetKey: string
}

/**
 * Links the viewed issue to another one in either direction. POST /issues/{source}/links only
 * creates outward links, so inward labels ("is blocked by", "is cloned by", …) are created from
 * the other issue. Refreshes both issues' projects (like the shared `useCreateLink`).
 */
export function useLinkIssue(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ type, direction, targetKey }: LinkIssueVariables) => {
      const self = normalizeKey(issueKey)
      const other = normalizeKey(targetKey)
      const [source, target] = direction === 'outward' ? [self, other] : [other, self]
      const body: CreateLinkInput = { type, targetKey: target }
      return api.post<IssueLink>(`/issues/${seg(source)}/links`, body)
    },
    onSuccess: (_link, { targetKey }) => invalidateProject(qc, [projectKeyOf(issueKey), projectKeyOf(targetKey)]),
  })
}
