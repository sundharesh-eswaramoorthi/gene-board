import { AlertTriangle, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { Button } from './Button'

/** Props of `EmptyState`. */
export interface EmptyStateProps {
  /** Lucide icon element, e.g. `<Inbox />`. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Call to action (a Button or Link). */
  action?: ReactNode
  /** `sm` for inside panels/columns, `md` (default) for page-level. */
  size?: 'sm' | 'md'
  className?: string
}

/** Friendly placeholder for empty lists / no results. */
export function EmptyState({ icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'gap-3 px-6 py-14' : 'gap-2 px-4 py-6',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-surface-sunken text-fg-subtle',
            size === 'md' ? 'size-12 [&_svg]:size-6' : 'size-9 [&_svg]:size-4.5',
          )}
        >
          {icon}
        </div>
      )}
      <div className="max-w-md">
        <p className={cn('font-semibold text-fg', size === 'md' ? 'text-base' : 'text-sm')}>{title}</p>
        {description && (
          <p className={cn('mt-1 text-fg-muted', size === 'md' ? 'text-sm' : 'text-xs')}>{description}</p>
        )}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  )
}

/** Props of `ErrorState`. */
export interface ErrorStateProps {
  /** The error (message extracted with errorMessage). */
  error?: unknown
  title?: ReactNode
  /** Shows a "Try again" button. */
  onRetry?: () => void
  size?: 'sm' | 'md'
  className?: string
}

/** Load-failure placeholder with an optional retry button. */
export function ErrorState({ error, title = 'Couldn’t load this', onRetry, size = 'md', className }: ErrorStateProps) {
  return (
    <EmptyState
      size={size}
      className={className}
      icon={<AlertTriangle className="text-danger" />}
      title={title}
      description={error ? errorMessage(error) : undefined}
      action={
        onRetry && (
          <Button size="sm" icon={<RotateCw />} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  )
}
