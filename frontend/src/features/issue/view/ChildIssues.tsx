import { Maximize2, Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useCreateIssue } from '@/api/issues'
import type { IssueDetail, IssueType } from '@/api/types'
import { useCreateIssueModal } from '@/app/ModalsProvider'
import { IssueTypeIcon, TypeSelect } from '@/components/issue'
import { Button, IconButton, Input, SegmentedProgress } from '@/components/ui'
import { cn } from '@/lib/cn'
import { percent } from '@/lib/format'
import { allowedChildTypes, ISSUE_TYPE_META } from '@/lib/issueMeta'
import { toastSaveError } from '../shared/errors'
import { IssueRefRow } from './IssueRefRow'
import { useIssueView } from './IssueViewContext'
import { childNoun } from './issueViewUtils'

/** Props of `ChildIssues`. */
export interface ChildIssuesProps {
  issue: IssueDetail
  /** The inline "create child" row is open (toggled from the summary toolbar too). */
  creating: boolean
  onCreatingChange: (creating: boolean) => void
}

/**
 * Child issues of an epic (stories/tasks/bugs) or subtasks of a standard issue: progress bar,
 * rows (click opens the child) and an inline quick-create row. Hidden when there's nothing to
 * show; never rendered for subtasks.
 */
export function ChildIssues({ issue, creating, onCreatingChange }: ChildIssuesProps) {
  const { canEdit } = useIssueView()
  const headingId = useId()
  const children = issue.children
  const total = children.length
  if (total === 0 && !creating) return null

  const done = children.filter((c) => c.status.category === 'done').length
  const inProgress = children.filter((c) => c.status.category === 'in_progress').length
  const isEpic = issue.type === 'epic'

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-fg">
          {isEpic ? 'Child issues' : 'Subtasks'}
        </h3>
        {total > 0 && (
          <span className="text-xs text-fg-muted tabular-nums">
            {done} of {total} done
          </span>
        )}
        {canEdit && !creating && (
          <IconButton
            size="sm"
            className="ml-auto"
            label={`Create ${childNoun(issue.type)}`}
            icon={<Plus />}
            onClick={() => onCreatingChange(true)}
          />
        )}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-3">
          <SegmentedProgress
            className="flex-1"
            total={total}
            segments={[
              { value: done, tone: 'success', label: 'Done' },
              { value: inProgress, tone: 'info', label: 'In progress' },
            ]}
          />
          <span className="text-xs font-medium text-fg-muted tabular-nums">{percent(done, total)}%</span>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-border">
        {total > 0 && (
          <ul className="divide-y divide-border">
            {children.map((child) => (
              <IssueRefRow
                key={child.id}
                issue={child}
                assignee={child.assignee}
                storyPoints={isEpic ? child.storyPoints : undefined}
              />
            ))}
          </ul>
        )}
        {creating && (
          <ChildIssueComposer
            parent={issue}
            onClose={() => onCreatingChange(false)}
            className={total > 0 ? 'border-t border-border' : undefined}
          />
        )}
      </div>
    </section>
  )
}

/**
 * Quick-create row: type (epics offer story/task/bug; standard issues create subtasks) and
 * summary. Enter creates and keeps the row open for the next one; Escape closes it. "Open in
 * create dialog" hands the draft to the full Create issue modal.
 */
function ChildIssueComposer({
  parent,
  onClose,
  className,
}: {
  parent: IssueDetail
  onClose: () => void
  className?: string
}) {
  const types = allowedChildTypes(parent.type)
  const [type, setType] = useState<IssueType>(types[0] ?? 'subtask')
  const [summary, setSummary] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useCreateIssue()
  const { openCreateIssue } = useCreateIssueModal()
  const noun = ISSUE_TYPE_META[type].label.toLowerCase()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async () => {
    const text = summary.trim()
    if (!text || create.isPending) return
    try {
      await create.mutateAsync({ projectKey: parent.projectKey, type, summary: text, parentId: parent.id })
      setSummary('')
      inputRef.current?.focus()
    } catch (err) {
      toastSaveError(err, `Couldn’t create the ${noun}`)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const openFullForm = () => {
    openCreateIssue({
      projectKey: parent.projectKey,
      type,
      parentId: parent.id,
      parentKey: parent.key,
      parentType: parent.type,
      summary: summary.trim() || undefined,
    })
    onClose()
  }

  return (
    <div data-local-escape className={cn('flex items-center gap-2 bg-surface px-2 py-1.5', className)}>
      {types.length > 1 ? (
        <TypeSelect
          variant="compact"
          value={type}
          types={types}
          onChange={setType}
          aria-label={`Type of the new issue: ${ISSUE_TYPE_META[type].label}`}
        />
      ) : (
        <span className="flex w-7 shrink-0 justify-center">
          <IssueTypeIcon type={type} />
        </span>
      )}
      <Input
        ref={inputRef}
        size="sm"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={onKeyDown}
        readOnly={create.isPending}
        maxLength={255}
        placeholder="What needs to be done?"
        aria-label={`Summary of the new ${noun}`}
        className="min-w-0 flex-1"
      />
      <Button variant="primary" size="sm" loading={create.isPending} disabled={!summary.trim()} onClick={() => void submit()}>
        Create
      </Button>
      <IconButton size="sm" label="Open in create dialog" icon={<Maximize2 />} onClick={openFullForm} />
      <IconButton size="sm" label="Cancel" icon={<X />} onClick={onClose} />
    </div>
  )
}
