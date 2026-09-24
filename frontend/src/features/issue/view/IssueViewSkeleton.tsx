import { X } from 'lucide-react'
import { IconButton, Skeleton, SkeletonText } from '@/components/ui'
import { IssueLayout } from './IssueLayout'
import type { IssueViewVariant } from './IssueViewContext'

/** Loading placeholder shaped like the issue view (no layout jump when data arrives). */
export function IssueViewSkeleton({ variant, onClose }: { variant: IssueViewVariant; onClose?: () => void }) {
  return (
    <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <span role="status" className="sr-only">
        Loading issue…
      </span>
      <IssueLayout
        variant={variant}
        header={
          <>
            <div className="flex flex-1 items-center gap-2" aria-hidden>
              <Skeleton className="size-5 rounded-[4px]" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-16" />
            </div>
            {onClose && <IconButton label="Close" icon={<X />} onClick={onClose} />}
          </>
        }
        summary={
          <div className="flex flex-col gap-3" aria-hidden>
            <Skeleton className="h-8 w-3/4" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-7 w-24" />
            </div>
          </div>
        }
        aside={
          <div className="flex flex-col gap-4" aria-hidden>
            <Skeleton className="h-8 w-32" />
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${50 + ((i * 23) % 45)}%` }} />
                </div>
              ))}
            </div>
          </div>
        }
        content={
          <div className="flex flex-col gap-8" aria-hidden>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-24" />
              <SkeletonText lines={4} />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-20" />
              <div className="flex gap-3">
                <Skeleton className="size-8 rounded-full" />
                <SkeletonText lines={2} className="flex-1" />
              </div>
            </div>
          </div>
        }
      />
    </div>
  )
}
