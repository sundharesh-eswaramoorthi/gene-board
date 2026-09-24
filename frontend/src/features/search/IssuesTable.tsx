import type { MouseEvent } from 'react'
import type { Issue, SortOrder } from '@/api/types'
import { useIssueModal } from '@/app/ModalsProvider'
import { DueDateLabel } from '@/components/issue/DueDateLabel'
import { IssueKeyLink } from '@/components/issue/IssueKeyLink'
import { IssueTypeIcon } from '@/components/issue/IssueTypeIcon'
import { LabelList } from '@/components/issue/LabelChip'
import { PriorityIcon } from '@/components/issue/PriorityIcon'
import { StatusLozenge } from '@/components/issue/StatusLozenge'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { formatDateTime, formatRelative } from '@/lib/dates'
import { SORT_COLUMNS, type SortColumn } from './issueFilters'
import { IssueOpenLink } from './IssueOpenLink'

/** Props of {@link IssuesTable}. */
export interface IssuesTableProps {
  issues: readonly Issue[]
  sort: SortColumn
  order: SortOrder
  onSort: (column: SortColumn) => void
  /** Render skeleton rows (first load). */
  loading?: boolean
  /** Fade the rows (showing the previous results while new ones load). */
  stale?: boolean
}

const COLUMNS: { column: SortColumn; className?: string; srLabel?: boolean }[] = [
  { column: 'type', className: 'w-11', srLabel: true },
  { column: 'key', className: 'w-24' },
  { column: 'summary' },
  { column: 'status', className: 'w-36' },
  { column: 'priority', className: 'w-28' },
  { column: 'assignee', className: 'w-40' },
  { column: 'created', className: 'w-28' },
  { column: 'updated', className: 'w-28' },
  { column: 'due', className: 'w-24' },
]

/** True when the click landed on a nested control (link, button…) that handles it itself. */
function fromInteractive(e: MouseEvent): boolean {
  return (e.target as HTMLElement).closest('a, button, input, select, textarea, [role="button"]') !== null
}

/**
 * Sortable issue table (type, key, summary, status, priority, assignee, created, updated, due). A row
 * click opens the issue modal; the summary is also a real link for keyboard users and for
 * opening the full page in a new tab.
 */
export function IssuesTable({ issues, sort, order, onSort, loading = false, stale = false }: IssuesTableProps) {
  const { openIssue } = useIssueModal()
  return (
    <Table className="min-w-[1100px] table-fixed" data-testid="issues-table" aria-busy={loading || stale || undefined}>
      <caption className="sr-only">Issues. Column headers sort the table.</caption>
      <TableHeader>
        <TableRow>
          {COLUMNS.map(({ column, className, srLabel }) => (
            <TableHead
              key={column}
              className={className}
              sort={sort === column ? order : null}
              onSort={() => onSort(column)}
            >
              {srLabel ? (
                <>
                  <span className="sr-only">{SORT_COLUMNS[column].label}</span>
                  <span aria-hidden>T</span>
                </>
              ) : (
                SORT_COLUMNS[column].label
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className={cn('transition-opacity', stale && 'opacity-60')}>
        {loading
          ? Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} index={i} />)
          : issues.map((issue) => (
              <TableRow
                key={issue.id}
                interactive
                data-testid={`issue-row-${issue.key}`}
                onClick={(e) => {
                  if (!fromInteractive(e)) openIssue(issue.key)
                }}
              >
                <TableCell>
                  <IssueTypeIcon type={issue.type} />
                </TableCell>
                <TableCell>
                  <IssueKeyLink issueKey={issue.key} tone="muted" done={issue.resolvedAt != null} />
                </TableCell>
                <TableCell>
                  <div className="@container flex min-w-0 items-center gap-2">
                    {issue.parent && issue.type === 'subtask' && (
                      <span className="shrink-0 text-xs text-fg-subtle">{issue.parent.key} /</span>
                    )}
                    <IssueOpenLink
                      issueKey={issue.key}
                      title={issue.summary}
                      className="min-w-0 truncate text-fg hover:text-primary hover:underline"
                    >
                      {issue.summary}
                    </IssueOpenLink>
                    <LabelList labels={issue.labels} max={2} className="hidden shrink-0 @sm:inline-flex" />
                  </div>
                </TableCell>
                <TableCell>
                  <StatusLozenge status={issue.status} />
                </TableCell>
                <TableCell className="text-fg-muted">
                  <PriorityIcon priority={issue.priority} showLabel />
                </TableCell>
                <TableCell>
                  <UserAvatar user={issue.assignee} size="sm" showName className="text-sm" />
                </TableCell>
                <TableCell className="text-sm text-fg-muted">
                  <Tooltip content={formatDateTime(issue.createdAt)}>
                    <time dateTime={issue.createdAt} className="whitespace-nowrap">
                      {formatRelative(issue.createdAt)}
                    </time>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-sm text-fg-muted">
                  <Tooltip content={formatDateTime(issue.updatedAt)}>
                    <time dateTime={issue.updatedAt} className="whitespace-nowrap">
                      {formatRelative(issue.updatedAt)}
                    </time>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-sm">
                  <DueDateLabel date={issue.dueDate} resolved={issue.resolvedAt != null} showIcon={false} emptyText="—" />
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <TableRow aria-hidden>
      <TableCell>
        <Skeleton className="size-4" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-14" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5" style={{ width: `${50 + ((index * 23) % 45)}%` }} />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-16" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-12" />
      </TableCell>
    </TableRow>
  )
}
