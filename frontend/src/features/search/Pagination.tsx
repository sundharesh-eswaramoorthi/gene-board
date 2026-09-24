import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/cn'

/** Props of {@link Pagination}. */
export interface PaginationProps {
  /** 1-based current page. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
}

/** Page numbers to render: first, last, current ± 1, with `null` for gaps (…). */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p))
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null)
    out.push(p)
  })
  return out
}

/** "1–50 of 234" plus previous / numbered / next page buttons. Hidden when everything fits on one page. */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(total, current * pageSize)

  return (
    <nav aria-label="Pagination" className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="text-sm text-fg-muted tabular-nums" aria-live="polite">
        {total === 0 ? 'No issues' : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            label="Previous page"
            icon={<ChevronLeft />}
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
          />
          {pageWindow(current, pageCount).map((p, i) =>
            p == null ? (
              <span key={`gap-${i}`} className="px-1 text-sm text-fg-subtle" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={p === current ? 'page' : undefined}
                className={cn(
                  'h-7 min-w-7 rounded-sm px-1.5 text-sm font-medium tabular-nums transition-colors',
                  p === current ? 'bg-primary-subtle text-primary' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {p}
              </button>
            ),
          )}
          <IconButton
            size="sm"
            label="Next page"
            icon={<ChevronRight />}
            disabled={current >= pageCount}
            onClick={() => onPageChange(current + 1)}
          />
        </div>
      )}
    </nav>
  )
}
