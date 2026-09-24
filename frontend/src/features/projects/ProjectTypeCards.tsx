import { CircleCheck, Columns3, Repeat, type LucideIcon } from 'lucide-react'
import { useId } from 'react'
import type { ProjectType } from '@/api/types'
import { cn } from '@/lib/cn'
import { PROJECT_TYPE_META } from '@/lib/issueMeta'

const TYPES: { value: ProjectType; icon: LucideIcon; tagline: string }[] = [
  { value: 'scrum', icon: Repeat, tagline: 'Sprints & backlog' },
  { value: 'kanban', icon: Columns3, tagline: 'Continuous flow' },
]

/** Props of {@link ProjectTypeCards}. */
export interface ProjectTypeCardsProps {
  value: ProjectType
  onChange: (type: ProjectType) => void
  /** Group label (visible). */
  legend?: string
  disabled?: boolean
  /** Helper text under the cards. */
  hint?: string
  className?: string
}

/**
 * Scrum / Kanban choice as two selectable cards. Built on native radio inputs, so arrow keys
 * move the selection and screen readers announce a radio group.
 */
export function ProjectTypeCards({ value, onChange, legend = 'Project type', disabled = false, hint, className }: ProjectTypeCardsProps) {
  const name = useId()
  const hintId = hint ? `${name}-hint` : undefined
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-1.5', className)} disabled={disabled} aria-describedby={hintId}>
      <legend className="mb-1.5 text-xs font-semibold text-fg-muted">{legend}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TYPES.map(({ value: type, icon: Icon, tagline }) => {
          const selected = value === type
          const meta = PROJECT_TYPE_META[type]
          return (
            <label
              key={type}
              data-testid={`project-type-${type}`}
              className={cn(
                'relative flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                selected
                  ? 'border-primary bg-primary-subtle/50'
                  : 'border-border-strong bg-surface hover:border-fg-subtle hover:bg-surface-hover',
                disabled && 'cursor-not-allowed opacity-60 hover:bg-surface',
              )}
            >
              <input
                type="radio"
                name={name}
                value={type}
                checked={selected}
                onChange={() => onChange(type)}
                className="sr-only"
              />
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md',
                  selected ? 'bg-primary text-primary-fg' : 'bg-surface-sunken text-fg-muted',
                )}
                aria-hidden
              >
                <Icon className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1 pr-5">
                <span className="block text-sm font-semibold text-fg">{meta.label}</span>
                <span className="block text-xs font-medium text-fg-muted">{tagline}</span>
                <span className="mt-1 block text-xs text-fg-subtle">{meta.description}</span>
              </span>
              {selected && <CircleCheck className="absolute top-3 right-3 size-4 text-primary" aria-hidden />}
            </label>
          )
        })}
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
    </fieldset>
  )
}
