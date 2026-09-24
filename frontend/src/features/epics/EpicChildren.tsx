import { Plus } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useIssues } from '@/api/issues'
import type { Issue } from '@/api/types'
import { useCreateIssueModal, useIssueModal } from '@/app/ModalsProvider'
import {
  IssueKeyLink,
  IssueTypeIcon,
  PriorityIcon,
  StatusLozenge,
  StoryPointsBadge,
  UserAvatar,
} from '@/components/issue'
import { Button, ErrorState, SkeletonRows } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isDone } from '@/lib/issueMeta'
import { pluralize } from '@/lib/format'

/** Upper bound of GET /issues `limit`; epics rarely come close. */
const CHILD_LIMIT = 200

/** Props of `EpicChildren`. */
export interface EpicChildrenProps {
  projectKey: string
  epic: Pick<Issue, 'id' | 'key' | 'summary'>
  /** Expected number of children (from the epic's progress) — sizes the loading skeleton. */
  expectedCount: number
  canEdit: boolean
}

/** The child issues of an epic (GET /issues?parentId=), ordered by rank, plus "Add child issue". */
export function EpicChildren({ projectKey, epic, expectedCount, canEdit }: EpicChildrenProps) {
  const { openCreateIssue } = useCreateIssueModal()
  const children = useIssues({ project: projectKey, parentId: epic.id, sort: 'rank', limit: CHILD_LIMIT })

  const addChild = () =>
    openCreateIssue({ projectKey, type: 'story', parentId: epic.id, parentKey: epic.key, parentType: 'epic' })

  let body
  if (children.isPending) {
    body = (
      <SkeletonRows
        rows={Math.min(Math.max(expectedCount, 1), 4)}
        className="overflow-hidden rounded-md border border-border bg-surface"
      />
    )
  } else if (children.isError) {
    body = (
      <ErrorState
        size="sm"
        error={children.error}
        title="Couldn’t load child issues"
        onRetry={() => void children.refetch()}
      />
    )
  } else if (children.data.items.length === 0) {
    body = (
      <p className="rounded-md border border-dashed border-border-strong px-3 py-3 text-sm text-fg-muted">
        No child issues yet.{canEdit && ' Break this epic down into stories, tasks and bugs.'}
      </p>
    )
  } else {
    const { items, total } = children.data
    body = (
      <>
        <ul
          aria-label={`Child issues of ${epic.key}`}
          className="@container overflow-hidden rounded-md border border-border bg-surface"
        >
          {items.map((issue) => (
            <ChildIssueRow key={issue.id} issue={issue} />
          ))}
        </ul>
        {total > items.length && (
          <p className="mt-1.5 text-xs text-fg-subtle">
            Showing the first {items.length} of {pluralize(total, 'child issue')}.
          </p>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {body}
      {canEdit && (
        <div>
          <Button size="sm" variant="subtle" icon={<Plus />} onClick={addChild} data-testid={`epic-add-child-${epic.key}`}>
            Add child issue
          </Button>
        </div>
      )}
    </div>
  )
}

function ChildIssueRow({ issue }: { issue: Issue }) {
  const { openIssue } = useIssueModal()
  const done = isDone(issue)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openIssue(issue.key)
    }
  }
  return (
    <li className="border-b border-border last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${issue.key}: ${issue.summary}`}
        onClick={() => openIssue(issue.key)}
        onKeyDown={onKeyDown}
        className="flex h-9 cursor-pointer items-center gap-2.5 px-3 text-sm transition-colors hover:bg-surface-hover focus-visible:-outline-offset-2"
      >
        <IssueTypeIcon type={issue.type} />
        <IssueKeyLink issueKey={issue.key} tone="muted" done={done} className="text-xs" />
        <span className={cn('min-w-0 flex-1 truncate', done && 'text-fg-muted')}>{issue.summary}</span>
        <PriorityIcon priority={issue.priority} size="sm" className="hidden @md:inline-flex" />
        <span className="hidden w-28 shrink-0 justify-end @sm:flex">
          <StatusLozenge status={issue.status} />
        </span>
        <span className="flex w-6 shrink-0 justify-center">
          <StoryPointsBadge points={issue.storyPoints} />
        </span>
        <UserAvatar user={issue.assignee} size="sm" />
      </div>
    </li>
  )
}
