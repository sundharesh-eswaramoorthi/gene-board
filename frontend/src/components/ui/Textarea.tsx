import { useCallback, useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from 'react'
import { charLimitProps } from '@/lib/chars'
import { cn } from '@/lib/cn'
import { useFieldControl } from './Field'
import { controlClasses } from './Input'

/** Props of `Textarea`. */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with the content between `minRows` and `maxRows` (default true). */
  autoResize?: boolean
  minRows?: number
  maxRows?: number
  /** Longest value in characters, as the API counts them (an emoji is one, unlike the native attribute). */
  maxLength?: number
  ref?: Ref<HTMLTextAreaElement>
}

/** Multi-line text control; auto-grows with its content by default. */
export function Textarea({
  autoResize = true,
  minRows = 3,
  maxRows = 20,
  className,
  onInput,
  maxLength,
  onChange,
  ref,
  ...rest
}: TextareaProps) {
  const props = useFieldControl(rest)
  const innerRef = useRef<HTMLTextAreaElement | null>(null)

  const resize = useCallback(() => {
    const el = innerRef.current
    if (!el || !autoResize) return
    const s = window.getComputedStyle(el)
    const line = parseFloat(s.lineHeight) || 20
    const padding = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom)
    const borders = parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth)
    el.style.height = 'auto'
    const needed = el.scrollHeight + borders
    const min = minRows * line + padding + borders
    const max = maxRows * line + padding + borders
    el.style.height = `${Math.min(Math.max(needed, min), max)}px`
    el.style.overflowY = needed > max ? 'auto' : 'hidden'
  }, [autoResize, minRows, maxRows])

  useLayoutEffect(resize, [resize, props.value])

  return (
    <textarea
      ref={(el) => {
        innerRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      rows={minRows}
      onInput={(e) => {
        resize()
        onInput?.(e)
      }}
      className={cn(controlClasses, 'block px-2.5 py-1.5 text-sm leading-5', autoResize && 'resize-none', className)}
      {...props}
      {...charLimitProps(maxLength, rest.value, onChange, rest)}
    />
  )
}
