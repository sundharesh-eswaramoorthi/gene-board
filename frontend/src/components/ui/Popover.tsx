import { Popover as RadixPopover } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { floatingPanelClasses } from './DropdownMenu'

/** Popover root (Radix): `<Popover><PopoverTrigger asChild>…</PopoverTrigger><PopoverContent>…` */
export const Popover = RadixPopover.Root
/** Trigger; use `asChild`. */
export const PopoverTrigger = RadixPopover.Trigger
/** Positions the popover against another element than the trigger. */
export const PopoverAnchor = RadixPopover.Anchor
/** Closes the popover when activated (use `asChild`). */
export const PopoverClose = RadixPopover.Close

/** Floating panel. Defaults: `align="start"`, 4px offset, padding 12px. */
export function PopoverContent({ className, sideOffset = 4, align = 'start', ...props }: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(floatingPanelClasses, 'p-3', className)}
        {...props}
      />
    </RadixPopover.Portal>
  )
}
