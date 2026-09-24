import { keepPreviousData } from '@tanstack/react-query'
import { SearchX, X } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useIssue } from '@/api/issues'
import { useIssueModal } from '@/app/ModalsProvider'
import { Button, EmptyState, ErrorState, IconButton, buttonClasses } from '@/components/ui'
import { useDocumentTitle } from '@/lib/hooks'
import { normalizeKey, projectKeyOf } from '@/lib/projectKey'
import { useProjectRole } from '@/lib/useProjectRole'
import { IssueView } from './IssueView'
import { IssueViewContext, type IssueViewContextValue, type IssueViewVariant, type UnsavedEdits } from './IssueViewContext'
import { IssueViewSkeleton } from './IssueViewSkeleton'

/** Props of `IssueViewLoader`. */
export interface IssueViewLoaderProps {
  issueKey: string
  variant: IssueViewVariant
  /** Modal only: closes the modal. */
  onClose?: () => void
  /** Modal only: renders the (visually hidden) dialog title for the current state. */
  renderTitle?: (title: string) => ReactNode
  /** Modal only: where editors report unsaved drafts. */
  unsavedEdits?: UnsavedEdits
}

/** Frame for the non-issue states (not found / error): a close button in the modal. */
function StateFrame({ variant, onClose, children }: { variant: IssueViewVariant; onClose?: () => void; children: ReactNode }) {
  if (variant === 'page') return <div className="py-12">{children}</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onClose && (
        <div className="flex shrink-0 justify-end px-4 pt-3">
          <IconButton label="Close" icon={<X />} onClick={onClose} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-12">{children}</div>
    </div>
  )
}

/**
 * Loads an issue and renders the matching state: skeleton, "not found or no access" (404),
 * load error with retry, or the {@link IssueView}. Provides the view context (variant,
 * permissions from the caller's project role, and in-view navigation).
 *
 * While the issue is being deleted its query is paused and the last data stays on screen, so
 * the view doesn't flash a 404 between the DELETE and closing / leaving.
 */
export function IssueViewLoader({ issueKey, variant, onClose, renderTitle, unsavedEdits }: IssueViewLoaderProps) {
  const navigate = useNavigate()
  const { openIssue: openInModal } = useIssueModal()
  const [deleting, setDeleting] = useState(false)
  const query = useIssue(issueKey, { enabled: !deleting, placeholderData: keepPreviousData })
  const role = useProjectRole(projectKeyOf(issueKey))

  const openIssue = useCallback(
    (key: string) => {
      if (variant === 'modal') openInModal(key)
      else navigate(`/browse/${normalizeKey(key)}`)
    },
    [variant, openInModal, navigate],
  )

  const context = useMemo<IssueViewContextValue>(
    () => ({ variant, openIssue, canEdit: role.canEdit && !deleting, isAdmin: role.isAdmin, deleting, unsavedEdits }),
    [variant, openIssue, role.canEdit, role.isAdmin, deleting, unsavedEdits],
  )

  const onDeleted = useCallback(() => {
    if (variant === 'modal') onClose?.()
    else navigate(`/projects/${projectKeyOf(issueKey)}/board`, { replace: true })
  }, [variant, onClose, navigate, issueKey])

  // Placeholder data only matters while deleting (the view is keyed by issue key). The view
  // waits for the caller's role too, so editable controls don't pop in after a read-only flash.
  const issue = query.isPlaceholderData && !deleting ? undefined : query.data
  const notFound = !deleting && query.error?.status === 404

  const title = notFound ? 'Issue not found' : issue ? `${issue.key}: ${issue.summary}` : issueKey
  useDocumentTitle(notFound ? 'Issue not found' : issue ? `[${issue.key}] ${issue.summary}` : issueKey)

  let body: ReactNode
  if (notFound) {
    body = (
      <StateFrame variant={variant} onClose={onClose}>
        <EmptyState
          icon={<SearchX />}
          title="Issue not found or you don’t have access"
          description={`${issueKey} may have been deleted, or it belongs to a project you’re not a member of.`}
          action={
            variant === 'modal' ? (
              <Button onClick={onClose}>Close</Button>
            ) : (
              <Link to="/" className={buttonClasses({ variant: 'primary' })}>
                Go to Your work
              </Link>
            )
          }
        />
      </StateFrame>
    )
  } else if (issue && !role.isLoading) {
    body = (
      <IssueView
        issue={issue}
        onClose={variant === 'modal' ? onClose : undefined}
        onDeleted={onDeleted}
        onDeletingChange={setDeleting}
      />
    )
  } else if (query.isError && !issue) {
    body = (
      <StateFrame variant={variant} onClose={onClose}>
        <ErrorState error={query.error} title={`Couldn’t load ${issueKey}`} onRetry={() => void query.refetch()} />
      </StateFrame>
    )
  } else {
    body = <IssueViewSkeleton variant={variant} onClose={variant === 'modal' ? onClose : undefined} />
  }

  return (
    <IssueViewContext value={context}>
      {renderTitle?.(title)}
      {body}
    </IssueViewContext>
  )
}
