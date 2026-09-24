import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Keyboard key hint: `<Kbd>C</Kbd>`, `<Kbd>⌘</Kbd><Kbd>Enter</Kbd>`. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-strong bg-surface-sunken px-1',
        'font-sans text-2xs font-medium text-fg-muted shadow-[inset_0_-1px_0_var(--border-strong)]',
        className,
      )}
      {...props}
    />
  )
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere — for shortcut hints. */
export const modKeyLabel: string =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'
