import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Pulsing placeholder block; size it with classes: `<Skeleton className="h-4 w-40" />`. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-shimmer rounded-sm bg-neutral-subtle', className)} {...props} />
}

/** A few lines of text placeholder with a shorter last line. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  )
}

/** Placeholder rows for lists/tables while loading. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 border-b border-border px-3 last:border-b-0">
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${55 + ((i * 17) % 35)}%` }} />
          <Skeleton className="size-6 rounded-full" />
        </div>
      ))}
    </div>
  )
}
