import { ChevronRight } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

/** PageHeader breadcrumb entry. */
export interface Breadcrumb {
  label: ReactNode
  /** Link target; the last crumb is usually plain text. */
  to?: string
}

/** Props of `PageHeader`. */
export interface PageHeaderProps {
  title: ReactNode
  breadcrumbs?: readonly Breadcrumb[]
  description?: ReactNode
  /** Buttons aligned right of the title. */
  actions?: ReactNode
  /** Toolbar row under the title (search, filters…). */
  children?: ReactNode
  className?: string
}

/** Page title block: breadcrumbs, H1, description, right-aligned actions and an optional toolbar. */
export function PageHeader({ title, breadcrumbs, description, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 pb-4', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-fg-muted">
          {breadcrumbs.map((crumb, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
              {crumb.to ? (
                <Link to={crumb.to} className="truncate rounded-sm hover:text-fg hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl leading-8 font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

const WIDTHS = {
  full: '',
  wide: 'mx-auto w-full max-w-7xl',
  narrow: 'mx-auto w-full max-w-3xl',
} as const

/** Standard page padding (24px × 20px) with an optional max width. */
export function PageContainer({
  size = 'full',
  className,
  children,
}: {
  size?: keyof typeof WIDTHS
  className?: string
  children: ReactNode
}) {
  return <div className={cn('px-6 py-5', WIDTHS[size], className)}>{children}</div>
}
