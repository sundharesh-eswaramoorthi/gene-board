import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Columns3, Plus } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useCreateStatus, useReorderStatuses, useStatuses } from '@/api/statuses'
import type { ID, Project, Status, StatusCategory } from '@/api/types'
import { StatusLozenge } from '@/components/issue/StatusLozenge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { toast, toastError } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { fieldErrors, isApiStatus } from '@/lib/errors'
import { STATUS_CATEGORIES, STATUS_CATEGORY_META } from '@/lib/issueMeta'
import { COLUMN_GRID, ColumnRow, SortableColumnRow, STATUS_NAME_MAX } from './ColumnRow'
import { DeleteColumnDialog } from './DeleteColumnDialog'
import { SettingsSection } from './SettingsSection'

const CATEGORY_OPTIONS = STATUS_CATEGORIES.map((c) => ({ value: c, label: STATUS_CATEGORY_META[c].label }))

/** Props of {@link ColumnsTab}. */
export interface ColumnsTabProps {
  project: Project
  isAdmin: boolean
}

/** Apply a locally reordered id list to the latest statuses (tolerating added / removed columns). */
function applyOrder(statuses: readonly Status[], order: readonly ID[] | null): Status[] {
  if (!order) return [...statuses]
  const byId = new Map(statuses.map((s) => [s.id, s]))
  const ordered = order.map((id) => byId.get(id)).filter((s): s is Status => s !== undefined)
  const missing = statuses.filter((s) => !order.includes(s.id))
  return [...ordered, ...missing]
}

/**
 * Board columns (= workflow statuses): drag (or use the keyboard) to reorder, rename inline,
 * change category and WIP limit, add and delete. Read-only for non-admins.
 */
export function ColumnsTab({ project, isAdmin }: ColumnsTabProps) {
  const statuses = useStatuses(project.key)
  const reorder = useReorderStatuses(project.key)
  const [localOrder, setLocalOrder] = useState<ID[] | null>(null)
  const [deleting, setDeleting] = useState<Status | null>(null)
  const latestReorder = useRef(0)

  const columns = useMemo(() => applyOrder(statuses.data ?? [], localOrder), [statuses.data, localOrder])
  const nameOf = (id: string | number) => columns.find((s) => s.id === id)?.name ?? 'column'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up column ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `Column ${nameOf(active.id)} is at position ${columns.findIndex((s) => s.id === over.id) + 1} of ${columns.length}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `Column ${nameOf(active.id)} dropped at position ${columns.findIndex((s) => s.id === over.id) + 1}.` : undefined,
    onDragCancel: ({ active }) => `Reordering cancelled. Column ${nameOf(active.id)} was not moved.`,
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = columns.map((s) => s.id)
    const from = ids.indexOf(Number(active.id))
    const to = ids.indexOf(Number(over.id))
    if (from < 0 || to < 0) return
    const next = arrayMove(ids, from, to)
    setLocalOrder(next)
    const run = ++latestReorder.current
    reorder.mutate(next, {
      onError: (err) => toastError(err, 'Couldn’t reorder the columns'),
      // The cache is fresh once the mutation settles; only the latest drag clears the override.
      onSettled: () => {
        if (run === latestReorder.current) setLocalOrder(null)
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Board columns"
        description={
          <>
            Each column is a workflow status, shown left to right on the board. The category sets the lozenge colour and
            whether issues count as resolved: moving an issue into a <span className="font-medium text-fg">Done</span>{' '}
            column resolves it.
          </>
        }
        bodyClassName="px-0 pb-0"
      >
        {statuses.isPending ? (
          <SkeletonRows rows={4} className="border-t border-border" />
        ) : statuses.isError ? (
          <ErrorState size="sm" error={statuses.error} title="Couldn’t load columns" onRetry={() => void statuses.refetch()} />
        ) : columns.length === 0 ? (
          <EmptyState size="sm" icon={<Columns3 />} title="No columns" />
        ) : (
          <>
            <BoardPreview columns={columns} />
            <div
              aria-hidden
              className={cn(
                COLUMN_GRID,
                'border-y border-border bg-surface-sunken px-3 py-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase',
              )}
            >
              <span />
              <span>Column</span>
              <span>Category</span>
              <span>WIP limit</span>
              <span />
            </div>
            {isAdmin ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={onDragEnd}
                accessibility={{
                  announcements,
                  screenReaderInstructions: {
                    draggable:
                      'To reorder a column, press Space or Enter to pick it up, use the up and down arrow keys to move it, then press Space or Enter again to drop it. Press Escape to cancel.',
                  },
                }}
              >
                <SortableContext items={columns.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <ol className="relative" data-testid="columns-list">
                    {columns.map((status) => (
                      <SortableColumnRow
                        key={status.id}
                        projectKey={project.key}
                        status={status}
                        isAdmin
                        canDelete={columns.length > 1}
                        onDelete={setDeleting}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            ) : (
              <ol data-testid="columns-list">
                {columns.map((status) => (
                  <ColumnRow
                    key={status.id}
                    projectKey={project.key}
                    status={status}
                    isAdmin={false}
                    canDelete={false}
                    onDelete={setDeleting}
                  />
                ))}
              </ol>
            )}
          </>
        )}
      </SettingsSection>

      {isAdmin && statuses.data && <AddColumnForm projectKey={project.key} existing={statuses.data} />}

      {deleting && statuses.data && (
        <DeleteColumnDialog
          projectKey={project.key}
          status={deleting}
          statuses={statuses.data}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

/** Miniature of the board's column order, updating live while reordering. */
function BoardPreview({ columns }: { columns: readonly Status[] }) {
  return (
    <div className="border-t border-border px-5 py-3" aria-hidden>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {columns.map((s) => (
          <div key={s.id} className="flex min-w-24 flex-1 flex-col gap-1.5 rounded-md bg-surface-sunken p-1.5">
            <StatusLozenge status={s} className="max-w-full" />
            <div className="h-2 rounded-[2px] bg-surface shadow-card" />
            <div className="h-2 w-3/4 rounded-[2px] bg-surface shadow-card" />
          </div>
        ))}
      </div>
    </div>
  )
}

function AddColumnForm({ projectKey, existing }: { projectKey: string; existing: readonly Status[] }) {
  const create = useCreateStatus(projectKey)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<StatusCategory>('in_progress')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Give the column a name')
    if (existing.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError(`A column named “${trimmed}” already exists`)
    }
    create.mutate(
      { name: trimmed, category },
      {
        onSuccess: (status) => {
          toast.success(`Added column “${status.name}”. Drag it into place on the list above.`)
          setName('')
          setError(null)
        },
        onError: (err) => {
          if (isApiStatus(err, 409)) setError(`A column named “${trimmed}” already exists`)
          else if (fieldErrors(err).name) setError(`Name ${fieldErrors(err).name}`)
          else toastError(err, 'Couldn’t add the column')
        },
      },
    )
  }

  return (
    <SettingsSection title="Add a column" description="New columns are added at the end of the board.">
      <form onSubmit={submit} noValidate className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]" data-testid="add-column-form">
        <Field label="Name" error={error ?? undefined}>
          <Input
            value={name}
            maxLength={STATUS_NAME_MAX}
            placeholder="e.g. QA"
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            data-testid="add-column-name"
          />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as StatusCategory)} options={CATEGORY_OPTIONS} />
        </Field>
        <Button type="submit" variant="primary" icon={<Plus />} loading={create.isPending} className="sm:mt-[1.375rem]">
          Add column
        </Button>
      </form>
    </SettingsSection>
  )
}
