import { useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { useIssueModal } from '@/app/ModalsProvider'
import { PageContainer } from '@/components/layout/PageHeader'
import { normalizeKey } from '@/lib/projectKey'
import { IssueViewLoader } from './view/IssueViewLoader'
import { createUnsavedEdits, type UnsavedEdits } from './view/IssueViewContext'
import { useConfirmUnload, useDiscardGuard } from './view/useDiscardGuard'

/**
 * Full-page issue view (`/browse/:issueKey`) inside the app layout — the same view as the
 * modal. Lower-case keys redirect to the canonical upper-case URL.
 *
 * With an unsaved description or comment draft, leaving the page (a link, another issue,
 * Back / Forward) asks to discard it first; reloading or closing the tab gets the browser's
 * prompt.
 */
export function IssuePage() {
  const { issueKey: rawKey = '' } = useParams()
  const location = useLocation()
  const { currentIssueKey: modalIssueKey } = useIssueModal()
  const [unsavedEdits] = useState(createUnsavedEdits)
  const issueKey = normalizeKey(rawKey)
  useConfirmUnload(unsavedEdits)

  if (rawKey !== issueKey) {
    return <Navigate to={{ pathname: `/browse/${issueKey}`, search: location.search, hash: location.hash }} replace />
  }

  return (
    <PageContainer size="wide" className="pb-12">
      {/* An issue modal opened over the page guards its own drafts (one blocker at a time). */}
      {!modalIssueKey && <PageDiscardGuard unsavedEdits={unsavedEdits} issueKey={issueKey} />}
      <IssueViewLoader key={issueKey} issueKey={issueKey} variant="page" unsavedEdits={unsavedEdits} />
    </PageContainer>
  )
}

/** Asks before navigating away from the page (to another path) with unsaved drafts. */
function PageDiscardGuard({ unsavedEdits, issueKey }: { unsavedEdits: UnsavedEdits; issueKey: string }) {
  useDiscardGuard(unsavedEdits, issueKey, (current, next) => current.pathname !== next.pathname)
  return null
}
