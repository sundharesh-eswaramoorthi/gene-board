import { useCallback, useEffect, useRef, useState } from 'react'

/** Returns `value` after it stopped changing for `delayMs` (default 250ms) — for search boxes. */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/**
 * `useState` persisted to localStorage as JSON (per-browser UI preferences such as collapsed
 * panels or filters). Storage failures are ignored.
 */
export function useLocalStorageState<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => readStorage(key, initialValue))
  const keyRef = useRef(key)

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key
      setState(readStorage(key, initialValue))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read only when the key changes
  }, [key])

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    [key],
  )
  return [state, set]
}

/** True when focus is in a text field / contenteditable (so single-key shortcuts should not fire). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type)
  }
  return false
}

/** Options of useHotkey. */
export interface HotkeyOptions {
  /** Require ⌘ (mac) / Ctrl (others). */
  mod?: boolean
  shift?: boolean
  /** Fire even while typing in inputs (default false; always true when `mod` is set). */
  allowInInputs?: boolean
  enabled?: boolean
}

/**
 * Global keyboard shortcut: `useHotkey('c', openCreate)`, `useHotkey('Enter', save, { mod: true })`.
 * Ignored while typing (unless `mod`/`allowInInputs`), while a dialog / menu / popover / listbox
 * is open (non-mod keys only), and when another handler already called preventDefault.
 */
export function useHotkey(key: string, handler: (event: KeyboardEvent) => void, options: HotkeyOptions = {}): void {
  const { mod = false, shift = false, allowInInputs = false, enabled = true } = options
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      const modPressed = e.metaKey || e.ctrlKey
      if (mod !== modPressed || shift !== e.shiftKey || e.altKey) return
      if (!mod && !allowInInputs && isTypingTarget(e.target)) return
      // Single-key shortcuts pause while a modal, menu, popover or listbox is open.
      if (!mod && document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
      e.preventDefault()
      handlerRef.current(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, mod, shift, allowInInputs, enabled])
}

/** Copy text to the clipboard; resolves false when the browser refuses. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Sets `document.title` to "<title> · Gene Board" while mounted (plain "Gene Board" when empty). */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} · Gene Board` : 'Gene Board'
    return () => {
      document.title = previous
    }
  }, [title])
}
