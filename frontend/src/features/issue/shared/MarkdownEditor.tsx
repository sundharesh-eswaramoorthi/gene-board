import { Eye, PenLine } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Kbd, modKeyLabel, SegmentedControl, Textarea } from '@/components/ui'
import { Markdown } from '@/components/ui/Markdown'
import { cn } from '@/lib/cn'

type EditorMode = 'write' | 'preview'

const MODE_OPTIONS = [
  {
    value: 'write' as const,
    label: (
      <>
        <PenLine aria-hidden />
        Write
      </>
    ),
  },
  {
    value: 'preview' as const,
    label: (
      <>
        <Eye aria-hidden />
        Preview
      </>
    ),
  },
]

/** Props of `MarkdownEditor`. */
export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minRows?: number
  maxRows?: number
  maxLength?: number
  /** Focus the textarea (caret at the end) when mounted. */
  autoFocus?: boolean
  /** ⌘/Ctrl+Enter anywhere in the editor. */
  onSubmit?: () => void
  /** Escape pressed inside the editor. */
  onEscape?: () => void
  /** Hint after "Markdown supported", e.g. what ⌘+Enter does. */
  submitHint?: string
  /**
   * A save is in flight: the text dims and turns read-only and the shortcuts pause. It stays
   * focusable (a disabled textarea would drop keyboard focus, and not get it back on failure).
   */
  saving?: boolean
  id?: string
  'aria-label'?: string
  'data-testid'?: string
  className?: string
  /** Rendered under the editor (Save / Cancel buttons). */
  footer?: ReactNode
}

/**
 * Markdown text area with Write / Preview tabs (GFM preview via the shared `Markdown`
 * renderer). ⌘/Ctrl+Enter calls `onSubmit`; Escape calls `onEscape`. The textarea stays mounted
 * in preview mode so undo history and the caret survive switching tabs.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minRows = 4,
  maxRows = 24,
  maxLength,
  autoFocus = false,
  onSubmit,
  onEscape,
  submitHint,
  saving = false,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
  className,
  footer,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<EditorMode>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    const el = textareaRef.current
    if (!el) return
    el.focus({ preventScroll: false })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [autoFocus])

  const changeMode = (next: EditorMode) => {
    setMode(next)
    if (next === 'write') requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || saving) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault()
      onSubmit()
    } else if (e.key === 'Escape' && onEscape && e.currentTarget.contains(e.target as Node)) {
      // Not `defaultPrevented`: an enclosing Radix dialog marks every Escape it lets through.
      e.preventDefault()
      onEscape()
    }
  }

  // ~20px per row + 16px vertical padding: keeps the preview as tall as the textarea.
  const minHeight = minRows * 20 + 16

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid={testId}>
      {/* Keyboard shortcuts for the whole editor (textarea and tab buttons). */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onKeyDown={onKeyDown}
        className={cn(
          'overflow-hidden rounded-sm border border-border-strong bg-surface transition-[border-color,box-shadow]',
          'focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25',
          saving && 'opacity-60',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-sunken px-1.5 py-1">
          <SegmentedControl size="sm" value={mode} onChange={changeMode} options={MODE_OPTIONS} aria-label="Editor mode" />
          <span className="hidden items-center gap-1 pr-1 text-2xs text-fg-subtle sm:flex">
            Markdown supported
            {onSubmit && submitHint && (
              <>
                <span aria-hidden>·</span>
                <Kbd>{modKeyLabel}</Kbd>
                <Kbd>Enter</Kbd>
                {submitHint}
              </>
            )}
          </span>
        </div>
        <Textarea
          ref={textareaRef}
          id={id}
          aria-label={ariaLabel}
          hidden={mode === 'preview'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          minRows={minRows}
          maxRows={maxRows}
          maxLength={maxLength}
          readOnly={saving}
          aria-busy={saving || undefined}
          className="rounded-none border-0 bg-transparent px-3 py-2 shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0"
        />
        {mode === 'preview' && (
          <div className="overflow-y-auto px-3 py-2" style={{ minHeight }}>
            {value.trim() ? (
              <Markdown>{value}</Markdown>
            ) : (
              <p className="text-sm text-fg-subtle">Nothing to preview</p>
            )}
          </div>
        )}
      </div>
      {footer}
    </div>
  )
}
