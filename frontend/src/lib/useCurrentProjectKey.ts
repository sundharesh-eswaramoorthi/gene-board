import { useMatch, useParams } from 'react-router'
import { projectKeyOf } from './projectKey'

/**
 * Project key of the current route (upper-cased): `/projects/:projectKey/...`, or derived from
 * `/browse/:issueKey`. Null elsewhere.
 */
export function useCurrentProjectKey(): string | null {
  const params = useParams()
  const browse = useMatch('/browse/:issueKey')
  const project = useMatch('/projects/:projectKey/*')
  const key = project?.params.projectKey ?? params.projectKey
  if (key) return key.toUpperCase()
  const issueKey = browse?.params.issueKey ?? params.issueKey
  return issueKey ? projectKeyOf(issueKey) : null
}
