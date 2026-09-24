import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  maxLength?: number
  /** Classes for the display text and the input (share typography, e.g. `text-xl font-semibold`). */
  className?: string
  /** Extra classes only for the input. */
  inputClassName?: string
  'data-testid'?: string
}

/**
 * Click-to-edit single-line text (issue summary, sprint/column names). Enter or blur saves,
 * Escape cancels. Read-only (plain text) when `disabled`.
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlur = useRef(false)
  /** Set by a failed save: the input is disabled while saving, so focus returns once it re-enables. */
  const refocusAfterSave = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (saving || !refocusAfterSave.current) return
    refocusAfterSave.current = false
    inputRef.current?.focus()
  }, [saving])

  const commit = async () => {
    const next = draft.trim()
    if (next === value.trim()) {
      setEditing(false)
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
      setEditing(false)
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
      setDraft(value)
      setEditing(false)
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
    return (
      <input
        ref={inputRef}
        data-testid={testId}
        // Escape cancels the edit; it must not also close a surrounding Dialog.
        data-local-escape
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
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
    )
  }

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`Edit ${label.toLowerCase()}: ${value}`}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={cn(
        '-mx-1.5 block w-[calc(100%+0.75rem)] cursor-text rounded-sm border border-transparent px-1.5 text-left break-words hover:bg-surface-hover',
        className,
      )}
    >
      {value || <span className="text-fg-subtle">{placeholder}</span>}
    </button>
  )
}
