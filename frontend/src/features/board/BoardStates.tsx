import { Rocket } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClasses } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'

const SKELETON_CARDS = [3, 2, 2, 1]

/** Placeholder toolbar + columns while the board loads. */
export function BoardSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" aria-busy="true" aria-label="Loading board">
      <div className="flex items-center gap-2" aria-hidden>
        <Skeleton className="h-8 w-48" />
        <div className="flex -space-x-1 pl-1">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="size-8 rounded-full ring-2 ring-surface" />
          ))}
        </div>
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden" aria-hidden>
        {SKELETON_CARDS.map((cards, column) => (
          <div key={column} className="flex h-full max-w-96 min-w-60 flex-1 basis-0 flex-col gap-1.5 rounded-lg bg-surface-sunken p-1.5">
            <div className="flex h-8 items-center gap-2 px-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-4" />
            </div>
            {Array.from({ length: cards }, (_, i) => (
              <div key={i} className="flex flex-col gap-2.5 rounded-md bg-surface p-2.5 shadow-card">
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className={cn('h-3.5', (column + i) % 2 ? 'w-2/5' : 'w-3/5')} />
                <div className="flex items-center gap-2">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="ml-auto size-5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Scrum project without an active sprint. */
export function NoActiveSprint({ projectKey, canEdit }: { projectKey: string; canEdit: boolean }) {
  return (
    <EmptyState
      icon={<Rocket />}
      title="No active sprint"
      description={
        canEdit
          ? 'Plan a sprint in the backlog and start it — its issues will show up here, ready to move across the board.'
          : 'When the team starts a sprint from the backlog, its issues will show up here.'
      }
      action={
        <Link to={`/projects/${projectKey}/backlog`} className={buttonClasses({ variant: 'primary' })}>
          Go to Backlog
        </Link>
      }
      className="h-full"
    />
  )
}

/** Slim information row between the toolbar and the columns. */
export function BoardNotice({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-fg-muted">
      <span className="flex shrink-0 text-fg-subtle [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}
