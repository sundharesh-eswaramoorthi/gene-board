import { Check } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { LABEL_COLORS } from '@/lib/colors'
import { colorName } from './labelPalette'

/** Props of {@link ColorSwatches}. */
export interface ColorSwatchesProps {
  /** Selected `#RRGGBB` (case-insensitive). */
  value: string
  onChange: (color: string) => void
  /**
   * `radio` (forms): a radio group — arrow keys move and select.
   * `buttons` (immediate actions, e.g. recolouring): arrow keys only move focus; Enter/Space picks.
   */
  mode?: 'radio' | 'buttons'
  'aria-label'?: string
  className?: string
}

/** The label colour palette as round swatches with a check on the selected one. */
export function ColorSwatches({ value, onChange, mode = 'radio', 'aria-label': ariaLabel = 'Colour', className }: ColorSwatchesProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = LABEL_COLORS.findIndex((c) => c.toUpperCase() === value.toUpperCase())
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    const jump = e.key === 'Home' ? 0 : e.key === 'End' ? LABEL_COLORS.length - 1 : null
    if (!delta && jump == null) return
    e.preventDefault()
    const next = jump ?? (index + delta + LABEL_COLORS.length) % LABEL_COLORS.length
    refs.current[next]?.focus()
    if (mode === 'radio') onChange(LABEL_COLORS[next])
  }

  return (
    <div
      role={mode === 'radio' ? 'radiogroup' : 'group'}
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {LABEL_COLORS.map((color, i) => {
        const selected = i === selectedIndex
        return (
          <button
            key={color}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role={mode === 'radio' ? 'radio' : undefined}
            aria-checked={mode === 'radio' ? selected : undefined}
            aria-pressed={mode === 'buttons' ? selected : undefined}
            aria-label={colorName(color)}
            title={colorName(color)}
            tabIndex={mode === 'radio' ? (i === focusIndex ? 0 : -1) : 0}
            onClick={() => onChange(color)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110',
              selected && 'ring-2 ring-fg/70 ring-offset-2 ring-offset-surface',
            )}
            style={{ backgroundColor: color }}
          >
            {selected && <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}
