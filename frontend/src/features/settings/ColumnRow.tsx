import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { useIssues } from '@/api/issues'
import { useUpdateStatus } from '@/api/statuses'
import type { Status, StatusCategory } from '@/api/types'
import { ChangedElsewhereNotice, EditableText, useEditDraft } from '@/components/ui/EditableText'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { toast, toastError } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { isApiStatus } from '@/lib/errors'
import { pluralize } from '@/lib/format'
import { STATUS_CATEGORIES, STATUS_CATEGORY_META } from '@/lib/issueMeta'

/** Max column (status) name length (SPEC §5). */
export const STATUS_NAME_MAX = 40

const CATEGORY_OPTIONS = STATUS_CATEGORIES.map((c) => ({ value: c, label: STATUS_CATEGORY_META[c].label }))

/** Shared column template of the header and the rows, so they line up. */
export const COLUMN_GRID = 'grid grid-cols-[1.75rem_minmax(0,1fr)_8.5rem_5.5rem_2rem] items-center gap-x-3'

/** Props of {@link ColumnRow}. */
export interface ColumnRowProps {
  projectKey: string
  status: Status
  isAdmin: boolean
  /** False for the project's only column. */
  canDelete: boolean
  onDelete: (status: Status) => void
  /** Drag handle (sortable rows only). */
  handle?: ReactNode
  dragging?: boolean
  style?: CSSProperties
  ref?: Ref<HTMLLIElement>
}

/**
 * One workflow column: name (inline rename), category, WIP limit, issue count and delete.
 * Read-only text for non-admins.
 */
export function ColumnRow({ projectKey, status, isAdmin, canDelete, onDelete, handle, dragging = false, style, ref }: ColumnRowProps) {
  const update = useUpdateStatus(projectKey)
  const count = useIssues({ project: projectKey, statusId: status.id, limit: 1 })
  const meta = STATUS_CATEGORY_META[status.category]

  const rename = async (name: string) => {
    try {
      await update.mutateAsync({ id: status.id, name })
    } catch (err) {
      if (isApiStatus(err, 409)) throw new Error(`A column named “${name}” already exists`)
      throw err
    }
  }

  const changeCategory = (category: StatusCategory) => {
    if (category === status.category) return
    update.mutate(
      { id: status.id, category },
      {
        onSuccess: () =>
          toast.success(
            category === 'done'
              ? `Issues in “${status.name}” now count as resolved`
              : `“${status.name}” is now a ${STATUS_CATEGORY_META[category].label} column`,
          ),
        onError: (err) => toastError(err, 'Couldn’t change the category'),
      },
    )
  }

  const saveWip = (wipLimit: number | null) =>
    update.mutateAsync({ id: status.id, wipLimit }).catch((err) => toastError(err, 'Couldn’t save the WIP limit'))

  return (
    <li
      ref={ref}
      style={style}
      data-testid={`column-row-${status.id}`}
      className={cn(
        COLUMN_GRID,
        'relative min-h-12 border-b border-border bg-surface px-3 py-1.5 last:rounded-b-[7px] last:border-b-0',
        dragging && 'z-10 rounded-md border border-primary shadow-raised',
      )}
    >
      <span className="flex justify-center">{handle}</span>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn('size-2.5 shrink-0 rounded-full', meta.dotClassName)} aria-hidden />
        <div className="min-w-0 flex-1">
          <EditableText
            value={status.name}
            label="Column name"
            disabled={!isAdmin}
            maxLength={STATUS_NAME_MAX}
            onSave={rename}
            className="text-sm leading-7 font-medium text-fg"
          />
        </div>
        <span className="hidden shrink-0 text-xs text-fg-subtle tabular-nums sm:inline" aria-live="polite">
          {count.data ? pluralize(count.data.total, 'issue') : ''}
        </span>
      </div>
      {isAdmin ? (
        <Select
          size="sm"
          aria-label={`Category of ${status.name}`}
          value={status.category}
          options={CATEGORY_OPTIONS}
          onChange={(e) => changeCategory(e.target.value as StatusCategory)}
        />
      ) : (
        <span className={cn('text-xs font-medium', meta.textClassName)}>{meta.label}</span>
      )}
      {isAdmin ? (
        <WipLimitInput value={status.wipLimit} columnName={status.name} onSave={saveWip} />
      ) : (
        <span className="text-xs text-fg-muted">{status.wipLimit ?? 'No limit'}</span>
      )}
      <span className="flex justify-center">
        {isAdmin && (
          <IconButton
            size="sm"
            variant="danger"
            label={`Delete column ${status.name}`}
            tooltip={canDelete ? 'Delete column' : 'A project needs at least one column'}
            icon={<Trash2 />}
            disabled={!canDelete}
            onClick={() => onDelete(status)}
          />
        )}
      </span>
    </li>
  )
}

/** A {@link ColumnRow} that can be dragged (handle) or moved with the keyboard to reorder. */
export function SortableColumnRow(props: Omit<ColumnRowProps, 'handle' | 'dragging' | 'style' | 'ref'>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.status.id,
  })
  return (
    <ColumnRow
      {...props}
      ref={setNodeRef}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder column ${props.status.name}`}
          className="flex size-7 cursor-grab touch-none items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-hover hover:text-fg active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      }
    />
  )
}

/**
 * WIP limit editor: blank = no limit, otherwise a whole number ≥ 1. Saves on blur / Enter,
 * Escape restores the saved value. Focusing it starts a draft ({@link useEditDraft}): until the
 * admin types it follows another admin's change and saves nothing; a typed number is kept and
 * the change is pointed out.
 */
function WipLimitInput({
  value,
  columnName,
  onSave,
}: {
  value: number | null
  columnName: string
  /** Settles once the save is done (failures are reported by the caller). */
  onSave: (wipLimit: number | null) => Promise<unknown>
}) {
  const saved = value == null ? '' : String(value)
  const { editing, draft, setDraft, start, stop, isEdit, changedElsewhere } = useEditDraft(saved)
  const [saving, setSaving] = useState(false)
  const noticeId = useId()
  const cancelled = useRef(false)

  const commit = async (input: HTMLInputElement) => {
    if (cancelled.current) {
      cancelled.current = false
      input.value = saved // also drops unparseable text, which reads as '' like "no limit"
      stop()
      return
    }
    const text = draft.trim()
    const next = text === '' ? null : Number(text)
    // Text the browser can't parse ("3e", "-") reads as '' — invalid, not "no limit".
    if (input.validity.badInput || (next !== null && (!Number.isInteger(next) || next < 1 || next > 9999))) {
      toast.error('The WIP limit must be a whole number from 1 to 9999, or empty for no limit')
      input.value = saved
      stop()
      return
    }
    // Untouched, or the same number as before or as someone else's new limit: nothing to save.
    if (!isEdit(next == null ? '' : String(next))) {
      stop()
      return
    }
    setSaving(true)
    await onSave(next)
    setSaving(false)
    stop()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelled.current = true
      e.currentTarget.blur()
    }
  }

  // The notice gets its own grid row under the column's row, so the WIP cell keeps its width.
  return (
    <>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        size="sm"
        placeholder="None"
        aria-label={`WIP limit of ${columnName}`}
        aria-describedby={changedElsewhere ? noticeId : undefined}
        value={editing ? draft : saved}
        disabled={saving}
        onFocus={start}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => void commit(e.currentTarget)}
        onKeyDown={onKeyDown}
        className="tabular-nums"
      />
      {changedElsewhere && (
        <ChangedElsewhereNotice id={noticeId} className="col-start-2 col-end-5 row-start-2 mb-0.5 justify-self-end">
          {value == null ? 'Someone else removed the WIP limit.' : `Someone else changed the WIP limit to ${value}.`} Saving
          replaces it; Esc keeps theirs.
        </ChangedElsewhereNotice>
      )}
    </>
  )
}
