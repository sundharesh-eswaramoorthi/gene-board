import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { IconButton, controlClasses, toast } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * A date input change with no keystroke on the input in the last this-many ms came from the
 * browser's calendar popup (which swallows keyboard events): it saves immediately.
 */
const PICKED_WITHOUT_TYPING_MS = 500

/** Props of `InlineEditInput`. */
export interface InlineEditInputProps {
  id: string
  type: 'number' | 'date'
  /** Accessible name, e.g. "Story points". */
  label: string
  /** Current raw value (`''` = empty): the input's value format. */
  value: string
  /** Rendering of a non-empty value in display mode. */
  display: ReactNode
  /** Plain-text version of `display` for the accessible name. */
  displayText: string
  placeholder?: string
  /** Viewer: render the value as plain text. */
  readOnly?: boolean
  /** Saving: editing can't start until it settles. */
  busy?: boolean
  /** Error message for an invalid raw value, or null when valid. */
  validate?: (raw: string) => string | null
  /**
   * Error shown when the browser can't parse what was typed (e.g. "5e" in a number input or
   * a half-typed date). Such an input reports an empty value, which must not clear the field.
   */
  badInputMessage?: string
  /** Persist a changed, valid raw value (`''` clears). */
  onCommit: (raw: string) => void
  /** Show a hover "clear" button when there is a value. */
  clearable?: boolean
  inputProps?: Pick<InputHTMLAttributes<HTMLInputElement>, 'min' | 'max' | 'step' | 'inputMode'>
}

/**
 * Click-to-edit value for the details panel (story points, due date): shows the value like the
 * inline pickers; clicking swaps in an input. Enter or blur saves, Escape cancels, empty clears.
 * Date inputs open the browser's calendar, and a day picked there saves immediately.
 */
export function InlineEditInput({
  id,
  type,
  label,
  value,
  display,
  displayText,
  placeholder = 'None',
  readOnly = false,
  busy = false,
  validate,
  badInputMessage = type === 'number' ? 'Enter a valid number' : 'Enter a valid date',
  onCommit,
  clearable = false,
  inputProps,
}: InlineEditInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayRef = useRef<HTMLButtonElement>(null)
  // Escape cancels (the input's blur must not save); Enter / Escape return focus to the value.
  const cancelled = useRef(false)
  const refocus = useRef(false)
  const lastKeyAt = useRef(0)

  useEffect(() => {
    if (!editing) return
    cancelled.current = false
    refocus.current = false
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (type === 'number') {
      el.select()
    } else {
      try {
        el.showPicker()
      } catch {
        // No transient activation / unsupported: the input is focused, which is enough.
      }
    }
  }, [editing, type])

  const start = () => {
    if (busy) return
    setDraft(value)
    setEditing(true)
  }

  const finish = (save: boolean, raw = draft) => {
    setEditing(false)
    // Keyboard users keep their place; a blur by clicking elsewhere leaves focus where it went.
    if (refocus.current) requestAnimationFrame(() => displayRef.current?.focus({ preventScroll: true }))
    if (!save) return
    // Unparseable text reads as '' — reject it instead of treating it as "clear the field".
    if (inputRef.current?.validity.badInput) {
      toast.error(badInputMessage)
      return
    }
    const next = raw.trim()
    if (next === value) return
    const problem = validate?.(next) ?? null
    if (problem) {
      toast.error(problem)
      return
    }
    onCommit(next)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setDraft(next)
    // Jira-like: picking a day in the calendar saves right away; typed dates save on Enter/blur.
    if (type === 'date' && performance.now() - lastKeyAt.current > PICKED_WITHOUT_TYPING_MS) {
      cancelled.current = true // the input unmounts; its blur must not save a second time
      refocus.current = true
      finish(true, next)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    lastKeyAt.current = performance.now()
    if (e.key === 'Enter') {
      e.preventDefault()
      const problem = e.currentTarget.validity.badInput ? badInputMessage : (validate?.(draft.trim()) ?? null)
      if (problem) {
        toast.error(problem)
        return
      }
      refocus.current = true
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelled.current = true
      refocus.current = true
      finish(false)
    }
  }

  const shown = value ? display : <span className="text-fg-subtle">{placeholder}</span>

  if (readOnly) {
    return (
      <span id={id} className="flex min-h-8 items-center text-sm text-fg">
        {shown}
      </span>
    )
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        id={id}
        type={type}
        aria-label={label}
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!cancelled.current) finish(true)
        }}
        {...inputProps}
        className={cn(
          controlClasses,
          '-mx-2 h-8 w-[calc(100%+1rem)] px-2 text-sm',
          type === 'number' &&
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
      />
    )
  }

  return (
    <div className="group/inline relative flex items-center">
      <button
        ref={displayRef}
        id={id}
        type="button"
        onClick={start}
        aria-label={`${label}: ${value ? displayText : placeholder}`}
        aria-busy={busy || undefined}
        className={cn(
          '-mx-2 flex min-h-8 w-[calc(100%+1rem)] items-center rounded-sm px-2 py-1 text-left text-sm text-fg transition-colors',
          busy ? 'cursor-progress' : 'hover:bg-surface-hover',
        )}
      >
        {shown}
      </button>
      {clearable && value && !busy && (
        <IconButton
          size="xs"
          label={`Clear ${label.toLowerCase()}`}
          icon={<X />}
          onClick={() => onCommit('')}
          className="absolute right-0 opacity-0 group-hover/inline:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        />
      )}
    </div>
  )
}
