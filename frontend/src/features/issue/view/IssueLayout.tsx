import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { IssueViewVariant } from './IssueViewContext'

/** Props of `IssueLayout`. */
export interface IssueLayoutProps {
  variant: IssueViewVariant
  /** Breadcrumb + actions row. */
  header: ReactNode
  /** Summary block (top of the main column). */
  summary: ReactNode
  /** Right-hand details panel. */
  aside: ReactNode
  /** Rest of the main column (description, child issues, links, activity). */
  content: ReactNode
  className?: string
}

/**
 * Two-column issue layout shared by the modal and the full page (and their skeletons).
 * From `lg` up the details panel sits on the right and sticks while the main column scrolls;
 * below that it stacks between the summary and the description. In the modal the header stays
 * fixed and the body scrolls; on the page the app's `<main>` scrolls.
 */
export function IssueLayout({ variant, header, summary, aside, content, className }: IssueLayoutProps) {
  const grid = (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{summary}</div>
      <aside
        aria-label="Issue details"
        className="min-w-0 lg:sticky lg:top-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
      >
        {aside}
      </aside>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">{content}</div>
    </div>
  )

  if (variant === 'modal') {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div className="flex shrink-0 items-center gap-3 px-6 pt-4 pb-3">{header}</div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pb-8">{grid}</div>
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center gap-3">{header}</div>
      {grid}
    </div>
  )
}
