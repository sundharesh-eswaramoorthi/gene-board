import type { ChangeEvent, ChangeEventHandler, CompositionEventHandler } from 'react'

/**
 * Length of `text` in characters (code points), as the API counts its limits. `.length` counts
 * UTF-16 units, so an emoji (or another character outside the BMP) would count twice.
 */
export function charCount(text: string): number {
  return [...text].length
}

/**
 * Keeps a text control's value within `max` characters after an edit, the way the native
 * `maxLength` does but counting characters, not UTF-16 units: input that makes the text longer is
 * cut from the end of what was typed or pasted (the caret), and text that was already longer
 * (`before`, the value before the edit) is not shortened.
 */
function limitChars(el: HTMLInputElement | HTMLTextAreaElement, max: number, before: string) {
  const allowed = Math.max(max, charCount(before))
  const excess = charCount(el.value) - allowed
  if (excess <= 0) return
  const caret = el.selectionEnd
  if (caret == null) {
    // Controls without a caret (email): keep the start.
    el.value = [...el.value].slice(0, allowed).join('')
    return
  }
  const typed = [...el.value.slice(0, caret)]
  const head = typed.slice(0, Math.max(0, typed.length - excess)).join('')
  el.value = [...(head + el.value.slice(caret))].slice(0, allowed).join('')
  el.setSelectionRange(head.length, head.length)
}

/** Each control being composed with an input method (IME): its value from before the composition. */
const beforeComposition = new WeakMap<Element, string>()

/** A control's own composition handlers, which {@link charLimitProps} calls from its own. */
export interface CompositionHandlers<E> {
  onCompositionStart?: CompositionEventHandler<E>
  onCompositionEnd?: CompositionEventHandler<E>
}

/**
 * `maxLength`, `onChange` and composition handlers for a text control limited to `max` characters
 * (Input, Textarea, EditableText). The native attribute counts UTF-16 units, which would leave
 * room for only half as many emoji: it gets twice the room as a backstop, and `onChange` applies
 * the real limit. Text being composed with an input method (IME) is cut only once it is committed
 * (compositionend), so the composition isn't broken; the cut then reaches `onChange` too.
 * Pass the control's own composition handlers as `handlers`: the returned ones replace them.
 */
export function charLimitProps<E extends HTMLInputElement | HTMLTextAreaElement>(
  max: number | undefined,
  value: unknown,
  onChange: ChangeEventHandler<E> | undefined,
  handlers: CompositionHandlers<E> = {},
): { maxLength?: number; onChange?: ChangeEventHandler<E> } & CompositionHandlers<E> {
  if (max == null) return { onChange }
  return {
    maxLength: 2 * max,
    onChange: (e) => {
      if (!(e.nativeEvent as InputEvent).isComposing) limitChars(e.currentTarget, max, typeof value === 'string' ? value : '')
      onChange?.(e)
    },
    onCompositionStart: (e) => {
      beforeComposition.set(e.currentTarget, e.currentTarget.value)
      handlers.onCompositionStart?.(e)
    },
    onCompositionEnd: (e) => {
      const el = e.currentTarget
      const before = beforeComposition.get(el)
      beforeComposition.delete(el)
      const committed = el.value
      if (before !== undefined) limitChars(el, max, before)
      // The browser reported the committed text while it was still being composed (uncut), and
      // the cut is no input event: report it as a change (the composition event, re-targeted).
      if (el.value !== committed) onChange?.(Object.assign(Object.create(e) as ChangeEvent<E>, { target: el, currentTarget: el }))
      handlers.onCompositionEnd?.(e)
    },
  }
}
