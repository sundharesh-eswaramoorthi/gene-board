import { Plus } from 'lucide-react'
import { useIssues } from '@/api/issues'
import type { Issue } from '@/api/types'
import { useCreateIssueModal } from '@/app/ModalsProvider'
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
  } else if (children.isLoadingError) {
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

/** A child issue: the key and summary are one link stretched over the row (like `IssueRefRow`). */
function ChildIssueRow({ issue }: { issue: Issue }) {
  const done = isDone(issue)
  return (
    <li className="relative flex h-9 items-center gap-2.5 border-b border-border px-3 text-sm transition-colors last:border-b-0 focus-within:bg-surface-hover hover:bg-surface-hover">
      <IssueTypeIcon type={issue.type} />
      <IssueKeyLink
        issueKey={issue.key}
        tone="muted"
        className="flex min-w-0 flex-1 items-baseline gap-2.5 after:absolute after:inset-0 hover:no-underline"
      >
        <span className={cn('shrink-0 text-xs', done && 'line-through')}>{issue.key}</span>
        <span className={cn('truncate font-normal', done ? 'text-fg-muted' : 'text-fg')}>{issue.summary}</span>
      </IssueKeyLink>
      <PriorityIcon priority={issue.priority} size="sm" className="hidden @md:inline-flex" />
      <span className="hidden w-28 shrink-0 justify-end @sm:flex">
        <StatusLozenge status={issue.status} />
      </span>
      <span className="flex w-6 shrink-0 justify-center">
        <StoryPointsBadge points={issue.storyPoints} />
      </span>
      {/* Above the row link, so the name tooltip shows. */}
      <span className="relative z-10 flex">
        <UserAvatar user={issue.assignee} size="sm" />
      </span>
    </li>
  )
}
