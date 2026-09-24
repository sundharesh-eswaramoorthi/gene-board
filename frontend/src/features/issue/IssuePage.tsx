import { Navigate, useLocation, useParams } from 'react-router'
import { PageContainer } from '@/components/layout/PageHeader'
import { normalizeKey } from '@/lib/projectKey'
import { IssueViewLoader } from './view/IssueViewLoader'

/**
 * Full-page issue view (`/browse/:issueKey`) inside the app layout — the same view as the
 * modal. Lower-case keys redirect to the canonical upper-case URL.
 */
export function IssuePage() {
  const { issueKey: rawKey = '' } = useParams()
  const location = useLocation()
  const issueKey = normalizeKey(rawKey)

  if (rawKey !== issueKey) {
    return <Navigate to={{ pathname: `/browse/${issueKey}`, search: location.search, hash: location.hash }} replace />
  }

  return (
    <PageContainer size="wide" className="pb-12">
      <IssueViewLoader key={issueKey} issueKey={issueKey} variant="page" />
    </PageContainer>
  )
}
