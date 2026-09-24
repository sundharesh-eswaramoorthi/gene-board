import { CircleCheck } from 'lucide-react'
import { useId, type ReactNode, type Ref } from 'react'
import type { Status } from '@/api/types'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { pluralize } from '@/lib/format'

/** Props of `BoardColumn`. */
export interface BoardColumnProps {
  status: Status
  /** Issues in the column (all of them, filters ignored) — drives the WIP limit. */
  total: number
  /** Issues currently shown. */
  shown: number
  /** Filters are narrowing the board. */
  filtered: boolean
  /** A card is being dragged somewhere on the board. */
  dragActive?: boolean
  /** The dragged card is currently over this column. */
  dropTarget?: boolean
  /** Ref for the droppable area (the whole column). */
  columnRef?: Ref<HTMLElement>
  /** `<li>` cards. */
  children: ReactNode
  /** Shown under the cards (e.g. "+ Create issue"). */
  footer?: ReactNode
}

/**
 * A board column: header with status name, issue count and WIP limit (`n/limit`, red when
 * exceeded), then the scrollable card list.
 */
export function BoardColumn({
  status,
  total,
  shown,
  filtered,
  dragActive = false,
  dropTarget = false,
  columnRef,
  children,
  footer,
}: BoardColumnProps) {
  const headingId = useId()
  const limit = status.wipLimit
  const overLimit = limit != null && total > limit
  const partial = filtered && shown !== total

  return (
    <section
      ref={columnRef}
      aria-labelledby={headingId}
      data-testid={`board-column-${status.id}`}
      className={cn(
        'relative flex h-full max-w-96 min-w-60 flex-1 basis-0 flex-col rounded-lg bg-surface-sunken transition-[background-color,box-shadow] duration-150',
        overLimit && 'bg-danger-subtle',
        dropTarget && 'bg-primary-subtle ring-2 ring-primary/40 ring-inset',
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-1.5 px-3">
        <h2 id={headingId} className="min-w-0 truncate text-xs font-semibold tracking-wide text-fg-muted uppercase" title={status.name}>
          {status.name}
        </h2>
        {status.category === 'done' && (
          <CircleCheck role="img" aria-label="Done category" className="size-3.5 shrink-0 text-success" />
        )}
        {(limit == null || partial) && (
          <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
            <span aria-hidden>{partial ? `${shown} of ${total}` : total}</span>
            <span className="sr-only">{partial ? `${shown} of ${pluralize(total, 'issue')} shown` : pluralize(total, 'issue')}</span>
          </span>
        )}
        {limit != null && (
          <Tooltip content={overLimit ? `Over the work-in-progress limit of ${limit}` : `Work-in-progress limit: ${limit}`}>
            <span
              className={cn(
                'ml-auto inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
                overLimit ? 'bg-danger text-danger-fg' : 'bg-neutral-subtle text-fg-muted',
              )}
            >
              <span aria-hidden>
                {total}/{limit}
              </span>
              <span className="sr-only">
                {`${pluralize(total, 'issue')}, work-in-progress limit ${limit}${overLimit ? ', limit exceeded' : ''}`}
              </span>
            </span>
          </Tooltip>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <ol aria-labelledby={headingId} className="flex flex-col gap-1.5">
          {children}
        </ol>
        {dragActive && shown === 0 && (
          <div
            aria-hidden
            className={cn(
              'flex h-20 items-center justify-center rounded-md border-2 border-dashed text-xs text-fg-subtle',
              dropTarget ? 'border-primary/50 text-primary' : 'border-border-strong',
            )}
          >
            Drop here
          </div>
        )}
        {footer && <div className="pt-1.5">{footer}</div>}
      </div>
    </section>
  )
}
