import { Tooltip as RadixTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Mount once near the root (done in main.tsx). */
export const TooltipProvider = RadixTooltip.Provider

/** Props of `Tooltip`. */
export interface TooltipProps {
  /** Tooltip text/content; when empty the child renders without a tooltip. */
  content: ReactNode
  /** A single focusable element (rendered via asChild). */
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Open delay in ms (default: provider's 400ms). */
  delayDuration?: number
  className?: string
}

/** Small dark tooltip on hover/focus: `<Tooltip content="Copy link"><IconButton … /></Tooltip>`. */
export function Tooltip({ content, children, side = 'top', align = 'center', delayDuration, className }: TooltipProps) {
  if (content == null || content === '' || content === false) return <>{children}</>
  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 max-w-xs rounded-sm bg-fg px-2 py-1 text-xs font-medium text-bg shadow-raised',
            'animate-fade-in select-none',
            className,
          )}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
