import type { IssueDetail } from '@/api/types'
import { toast } from '@/components/ui/toast'
import { truncate } from '@/lib/format'

/**
 * Success toast for a new issue: the key is a button that opens it in the issue modal (plain
 * buttons only — the toaster renders outside the router, so no `<Link>`).
 */
export function announceCreated(issue: IssueDetail, openIssue: (issueKey: string) => void): void {
  const open = () => {
    toast.dismiss(toastId)
    openIssue(issue.key)
  }
  const toastId = toast.success(
    <span>
      <button type="button" onClick={open} className="rounded-sm font-semibold underline-offset-2 hover:underline">
        {issue.key}
      </button>{' '}
      has been created
    </span>,
    {
      description: truncate(issue.summary, 90),
      action: { label: 'View', onClick: () => openIssue(issue.key) },
    },
  )
}
