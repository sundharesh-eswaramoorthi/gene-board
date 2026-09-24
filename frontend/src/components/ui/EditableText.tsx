import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { charLimitProps } from '@/lib/chars'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { toast } from './toast'

/** Props of `EditableText`. */
export interface EditableTextProps {
  value: string
  /** Persist the new (trimmed) value; may return a promise (stays in edit mode on rejection). */
  onSave: (value: string) => unknown
  /** Accessible name of the field, e.g. "Summary". */
  label: string
  placeholder?: string
  disabled?: boolean
  /** Return an error message to block saving (e.g. empty). Default: non-empty required. */
  validate?: (value: string) => string | null
  /** Longest value in characters, as the API counts them (an emoji is one). */
  maxLength?: number
  /** Classes for the display text and the input (share typography, e.g. `text-xl font-semibold`). */
  className?: string
  /** Extra classes only for the input. */
  inputClassName?: string
  'data-testid'?: string
}

/** Draft state of a click-to-edit field (see {@link useEditDraft}). */
export interface EditDraft {
  editing: boolean
  draft: string
  /** The user's input: from then on the draft stops following the live value. */
  setDraft: (draft: string) => void
  /** The user typed since editing started (until then the draft follows the live value). */
  touched: boolean
  /** Opens the editor on the current value. */
  start: () => void
  /** Closes the editor (callers save first when they should). */
  stop: () => void
  /** The editor is open and the user changed the draft. */
  dirty: boolean
  /**
   * Whether saving `text` (default: the draft) would change anything: it differs from the value
   * editing started from and from the current value.
   */
  isEdit: (text?: string) => boolean
  /** The user typed and someone else saved a new value meanwhile: saving an edit replaces it. */
  changedElsewhere: boolean
}

/**
 * Draft of a click-to-edit field whose saved `value` can change while the editor is open (live
 * updates from other users). Edits are measured against the value editing started from, not the
 * live one: leaving an untouched editor saves nothing (it never writes the stale text back over a
 * teammate's change), and a draft the user hasn't typed in follows the live value. Once they type,
 * the draft is theirs (it never jumps mid-typing, even back at the original text); when the value
 * changes under it `changedElsewhere` is set, so the editor can say so. Texts are compared trimmed.
 */
export function useEditDraft(value: string): EditDraft {
  const [editing, setEditing] = useState(false)
  const [draft, setDraftText] = useState(value)
  /** The user typed since editing started. */
  const [touched, setTouched] = useState(false)
  /** The saved value the draft is based on: set on start, moved along while nothing conflicts. */
  const [base, setBase] = useState(value)
  const edited = draft.trim() !== base.trim()

  // Adjusted while rendering (not in an effect) so a stale draft is never shown. Nothing conflicts
  // when the user hasn't typed (the draft takes the new value) or the draft already equals it (e.g.
  // this user's own save came back).
  if (editing && value !== base && (!touched || draft.trim() === value.trim())) {
    setBase(value)
    if (!touched) setDraftText(value)
  }

  return {
    editing,
    draft,
    setDraft: (text) => {
      setTouched(true)
      setDraftText(text)
    },
    touched,
    start: () => {
      setBase(value)
      setDraftText(value)
      setTouched(false)
      setEditing(true)
    },
    stop: () => setEditing(false),
    dirty: editing && edited,
    isEdit: (text = draft) => text.trim() !== base.trim() && text.trim() !== value.trim(),
    changedElsewhere: editing && touched && value.trim() !== base.trim(),
  }
}

/**
 * Note under an open editor whose value someone else changed meanwhile
 * ({@link EditDraft.changedElsewhere}). Phrasing content only, so it may sit inside a heading.
 */
export function ChangedElsewhereNotice({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <span
      id={id}
      role="status"
      className={cn('mt-1 flex items-start gap-1.5 text-xs leading-4 font-normal tracking-normal text-warning', className)}
    >
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

/**
 * Click-to-edit single-line text (issue summary, column/label names). Enter or blur saves,
 * Escape cancels; leaving it untouched saves nothing, even when the value changed meanwhile.
 * Read-only (plain text) when `disabled`.
 */
export function EditableText({
  value,
  onSave,
  label,
  placeholder = 'Add a value',
  disabled = false,
  validate = (v) => (v.trim() ? null : `${label} is required`),
  maxLength,
  className,
  inputClassName,
  'data-testid': testId,
}: EditableTextProps) {
  const { editing, draft, setDraft, touched, start, stop, dirty, changedElsewhere } = useEditDraft(value)
  const [saving, setSaving] = useState(false)
  const noticeId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlur = useRef(false)
  /** Set by a failed save: the input is disabled while saving, so focus returns once it re-enables. */
  const refocusAfterSave = useRef(false)

  // Select the text on open, and again whenever an untouched draft follows someone else's change
  // (React rewriting the value moves the caret to the end): the first keystroke replaces the text.
  useLayoutEffect(() => {
    if (editing && !touched) inputRef.current?.select()
  }, [editing, touched, draft])

  useEffect(() => {
    if (saving || !refocusAfterSave.current) return
    refocusAfterSave.current = false
    inputRef.current?.focus()
  }, [saving])

  const commit = async () => {
    const next = draft.trim()
    if (!dirty) {
      stop()
      return
    }
    const problem = validate(next)
    if (problem) {
      toast.error(problem)
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      stop()
    } catch (err) {
      toast.error(errorMessage(err))
      refocusAfterSave.current = true
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      skipBlur.current = true
      void commit().finally(() => (skipBlur.current = false))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      skipBlur.current = true
      stop()
      queueMicrotask(() => (skipBlur.current = false))
    }
  }

  if (disabled) {
    return (
      <span data-testid={testId} className={cn('block break-words', className)}>
        {value || <span className="text-fg-subtle">{placeholder}</span>}
      </span>
    )
  }

  if (editing) {
    // Same element tree with or without the notice, so the focused input is never remounted.
    return (
      <>
        <input
          ref={inputRef}
          data-testid={testId}
          // Escape cancels the edit; it must not also close a surrounding Dialog.
          data-local-escape
          aria-label={label}
          aria-describedby={changedElsewhere ? noticeId : undefined}
          value={draft}
          disabled={saving}
          {...charLimitProps<HTMLInputElement>(maxLength, draft, (e) => setDraft(e.target.value))}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!skipBlur.current) void commit()
          }}
          className={cn(
            '-mx-1.5 w-[calc(100%+0.75rem)] rounded-sm border border-primary bg-surface px-1.5 text-fg outline-none ring-2 ring-ring/25',
            className,
            inputClassName,
          )}
        />
        {changedElsewhere && (
          <ChangedElsewhereNotice id={noticeId}>
            {value ? `Someone else changed this to “${value}”.` : 'Someone else cleared this.'} Saving replaces it; Esc
            keeps theirs.
          </ChangedElsewhereNotice>
        )}
      </>
    )
  }

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`Edit ${label.toLowerCase()}: ${value}`}
      onClick={start}
      className={cn(
        '-mx-1.5 block w-[calc(100%+0.75rem)] cursor-text rounded-sm border border-transparent px-1.5 text-left break-words hover:bg-surface-hover',
        className,
      )}
    >
      {value || <span className="text-fg-subtle">{placeholder}</span>}
    </button>
  )
}
