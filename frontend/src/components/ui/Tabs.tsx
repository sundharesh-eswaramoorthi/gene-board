import { Tabs as RadixTabs } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Tabs root (Radix): `<Tabs value onValueChange>` or `defaultValue`. */
export const Tabs = RadixTabs.Root

/** Row of tab triggers with an underline. */
export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn('flex items-center gap-1 border-b border-border', className)} {...props} />
}

/** Tab trigger; the active one gets a primary underline. Optional `count` badge. */
export function TabsTrigger({
  className,
  children,
  count,
  ...props
}: ComponentProps<typeof RadixTabs.Trigger> & { count?: ReactNode }) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm font-medium text-fg-muted transition-colors',
        'hover:text-fg data-[state=active]:border-primary data-[state=active]:text-primary',
        'focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {count != null && (
        <span className="rounded-full bg-neutral-subtle px-1.5 text-2xs font-semibold text-fg-muted">{count}</span>
      )}
    </RadixTabs.Trigger>
  )
}

/** Tab panel. */
export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('pt-4 focus-visible:outline-none', className)} {...props} />
}
