import { ArrowRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useIssues } from '@/api/issues'
import { useDeleteStatus } from '@/api/statuses'
import type { ID, Status } from '@/api/types'
import { StatusLozenge } from '@/components/issue/StatusLozenge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { toast, toastError } from '@/components/ui/toast'
import { isApiStatus } from '@/lib/errors'
import { pluralize } from '@/lib/format'

/** Props of {@link DeleteColumnDialog}. */
export interface DeleteColumnDialogProps {
  projectKey: string
  /** The column to delete. */
  status: Status
  /** All columns of the project, in board order. */
  statuses: readonly Status[]
  onClose: () => void
}

/** Where the column's issues go by default: the nearest column of the same category, else the one before it. */
function defaultTarget(status: Status, statuses: readonly Status[]): ID | undefined {
  const others = statuses.filter((s) => s.id !== status.id)
  const byDistance = [...others].sort((a, b) => Math.abs(a.position - status.position) - Math.abs(b.position - status.position))
  return (byDistance.find((s) => s.category === status.category) ?? byDistance[0])?.id
}

/**
 * Delete a column. When issues use it, the admin picks the column they move to (the API
 * requires `moveTo` then and answers 409 without it).
 */
export function DeleteColumnDialog({ projectKey, status, statuses, onClose }: DeleteColumnDialogProps) {
  const others = statuses.filter((s) => s.id !== status.id)
  const [moveTo, setMoveTo] = useState<ID | undefined>(() => defaultTarget(status, statuses))
  const [conflict, setConflict] = useState(false)
  const count = useIssues({ project: projectKey, statusId: status.id, limit: 1 })
  const remove = useDeleteStatus(projectKey)

  const issueCount = count.data?.total
  // Unknown count (still loading / failed) or a 409 → ask where the issues go.
  const needsTarget = conflict || issueCount == null || issueCount > 0
  const target = others.find((s) => s.id === moveTo)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (remove.isPending || (needsTarget && !moveTo)) return
    remove.mutate(
      { id: status.id, moveTo: needsTarget ? moveTo : undefined },
      {
        onSuccess: () => {
          toast.success(
            issueCount && target
              ? `Deleted “${status.name}” and moved its ${pluralize(issueCount, 'issue')} to “${target.name}”`
              : `Deleted column “${status.name}”`,
          )
          onClose()
        },
        onError: (err) => {
          if (isApiStatus(err, 409) && !conflict && !needsTarget) {
            setConflict(true)
            toast.error('Some issues use this column. Choose where to move them.')
          } else toastError(err, 'Couldn’t delete the column')
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete column “${status.name}”?`}
      size="sm"
      onSubmit={submit}
      preventClose={remove.isPending}
      data-testid="delete-column-dialog"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={remove.isPending} disabled={needsTarget && !moveTo}>
            Delete column
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-fg-muted">
        {count.isPending ? (
          <p className="flex items-center gap-2">
            <Spinner size="xs" /> Checking which issues use this column…
          </p>
        ) : issueCount === 0 && !conflict ? (
          <p>No issues are in this column. It will be removed from the board.</p>
        ) : (
          <>
            <p>
              {issueCount != null && issueCount > 0
                ? `${pluralize(issueCount, 'issue')} ${issueCount === 1 ? 'is' : 'are'} in this column.`
                : 'Issues may be in this column.'}{' '}
              Choose where to move {issueCount === 1 ? 'it' : 'them'} before the column is removed.
            </p>
            <div className="flex items-end gap-3">
              <div className="flex h-8 shrink-0 items-center">
                <StatusLozenge status={status} />
              </div>
              <ArrowRight className="mb-2 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <Field label="Move issues to" className="min-w-0 flex-1">
                <Select
                  value={moveTo ?? ''}
                  onChange={(e) => setMoveTo(e.target.value ? Number(e.target.value) : undefined)}
                  options={others.map((s) => ({ value: s.id, label: s.name }))}
                  data-testid="delete-column-move-to"
                />
              </Field>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
