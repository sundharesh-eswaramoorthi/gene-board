import { Check, ChevronRight, Circle } from 'lucide-react'
import { DropdownMenu as RadixMenu, Slot } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Shared surface styling of floating panels (menus, popovers, pickers). */
export const floatingPanelClasses =
  'z-50 rounded-md border border-border bg-surface-raised text-fg shadow-overlay animate-slide-down focus:outline-none'

const itemClasses = cn(
  'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
  'data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  // Size bare icons only: an svg that sets its own size (e.g. inside IssueTypeIcon) keeps it.
  "[&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
)

/** Menu root (Radix DropdownMenu.Root): `<DropdownMenu><DropdownMenuTrigger asChild>…` */
export const DropdownMenu = RadixMenu.Root
/** Trigger; use `asChild` with a Button/IconButton. */
export const DropdownMenuTrigger = RadixMenu.Trigger
/** Groups items (no visual). */
export const DropdownMenuGroup = RadixMenu.Group
/** Radio group container; pair with DropdownMenuRadioItem. */
export const DropdownMenuRadioGroup = RadixMenu.RadioGroup
/** Submenu root. */
export const DropdownMenuSub = RadixMenu.Sub

/** Menu panel. Defaults: `align="start"`, 4px offset, min width 12rem. */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'start',
  ...props
}: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(floatingPanelClasses, 'max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-48 overflow-y-auto p-1', className)}
        {...props}
      />
    </RadixMenu.Portal>
  )
}

/** Props of `DropdownMenuItem`. */
export interface DropdownMenuItemProps extends ComponentProps<typeof RadixMenu.Item> {
  /** Leading icon. */
  icon?: ReactNode
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  shortcut?: ReactNode
  /** `danger` colours the item red (destructive actions). */
  tone?: 'default' | 'danger'
}

/**
 * Menu item; handle `onSelect` (not onClick). With `asChild` the single child (e.g. a router
 * `<Link>`) becomes the item and receives the icon/shortcut around its own content.
 */
export function DropdownMenuItem({ icon, shortcut, tone = 'default', className, children, asChild, ...props }: DropdownMenuItemProps) {
  const classes = cn(
    itemClasses,
    tone === 'danger' ? 'text-danger data-[highlighted]:bg-danger-subtle' : '[&>svg]:text-fg-muted',
    className,
  )
  const shortcutEl = shortcut && <span className="ml-auto pl-4 text-xs text-fg-subtle">{shortcut}</span>
  if (asChild) {
    return (
      <RadixMenu.Item asChild className={classes} {...props}>
        {icon}
        <Slot.Slottable>{children}</Slot.Slottable>
        {shortcutEl}
      </RadixMenu.Item>
    )
  }
  return (
    <RadixMenu.Item className={classes} {...props}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcutEl}
    </RadixMenu.Item>
  )
}

/** Checkbox item with a check mark when `checked`. */
export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof RadixMenu.CheckboxItem>) {
  return (
    <RadixMenu.CheckboxItem className={cn(itemClasses, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <RadixMenu.ItemIndicator>
          <Check className="text-primary" />
        </RadixMenu.ItemIndicator>
      </span>
      {children}
    </RadixMenu.CheckboxItem>
  )
}

/** Radio item (inside DropdownMenuRadioGroup) with a dot when selected. */
export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof RadixMenu.RadioItem>) {
  return (
    <RadixMenu.RadioItem className={cn(itemClasses, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <RadixMenu.ItemIndicator>
          <Circle className="size-2! fill-primary text-primary" />
        </RadixMenu.ItemIndicator>
      </span>
      {children}
    </RadixMenu.RadioItem>
  )
}

/** Small uppercase section heading inside a menu. */
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof RadixMenu.Label>) {
  return (
    <RadixMenu.Label
      className={cn('px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase', className)}
      {...props}
    />
  )
}

/** Hairline between groups. */
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

/** Item that opens a submenu. */
export function DropdownMenuSubTrigger({
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof RadixMenu.SubTrigger> & { icon?: ReactNode }) {
  return (
    <RadixMenu.SubTrigger className={cn(itemClasses, 'data-[state=open]:bg-surface-hover [&>svg]:text-fg-muted', className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight className="ml-auto" />
    </RadixMenu.SubTrigger>
  )
}

/** Submenu panel. */
export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof RadixMenu.SubContent>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.SubContent
        sideOffset={4}
        collisionPadding={8}
        className={cn(floatingPanelClasses, 'min-w-44 p-1', className)}
        {...props}
      />
    </RadixMenu.Portal>
  )
}
