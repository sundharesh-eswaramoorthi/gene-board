import { X } from 'lucide-react'
import type { Label } from '@/api/types'
import { cn } from '@/lib/cn'
import { chipStyle } from '@/lib/colors'

/** Props of `LabelChip`. */
export interface LabelChipProps {
  label: Pick<Label, 'name' | 'color'>
  /** Shows an × button. */
  onRemove?: () => void
  size?: 'sm' | 'md'
  className?: string
}

/** Label tinted with its colour (legible in both themes). */
export function LabelChip({ label, onRemove, size = 'sm', className }: LabelChipProps) {
  return (
    <span
      style={chipStyle(label.color)}
      title={label.name}
      className={cn(
        'chip-tint inline-flex max-w-40 shrink-0 items-center gap-1 rounded-[3px] font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-xs',
        className,
      )}
    >
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove label ${label.name}`}
          className="-mr-0.5 flex size-3.5 items-center justify-center rounded-[2px] opacity-70 hover:opacity-100 hover:ring-1 hover:ring-current"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

/** Up to `max` label chips followed by a "+n" chip with the rest in its tooltip. */
export function LabelList({ labels, max = 2, className }: { labels: readonly Label[]; max?: number; className?: string }) {
  if (labels.length === 0) return null
  const shown = labels.slice(0, max)
  const rest = labels.slice(max)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {shown.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {rest.length > 0 && (
        <span
          title={rest.map((l) => l.name).join(', ')}
          className="inline-flex h-5 shrink-0 items-center rounded-[3px] bg-neutral-subtle px-1.5 text-2xs font-semibold text-fg-muted"
        >
          +{rest.length}
        </span>
      )}
    </span>
  )
}
