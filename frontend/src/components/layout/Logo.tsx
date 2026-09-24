import { cn } from '@/lib/cn'

/** Gene Board mark (board columns in a rounded square), brand primary. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect x="7" y="8" width="5" height="16" rx="1.5" className="fill-primary-fg" />
      <rect x="13.5" y="8" width="5" height="11" rx="1.5" className="fill-primary-fg" opacity=".85" />
      <rect x="20" y="8" width="5" height="7" rx="1.5" className="fill-primary-fg" opacity=".7" />
    </svg>
  )
}

/** Logo mark + "Gene Board" wordmark (`hideWordmarkOnMobile` hides the text below 1024px). */
export function Logo({ className, hideWordmarkOnMobile = false }: { className?: string; hideWordmarkOnMobile?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span
        className={cn(
          'text-[15px] font-semibold tracking-tight whitespace-nowrap text-fg',
          hideWordmarkOnMobile && 'hidden lg:inline',
        )}
      >
        Gene Board
      </span>
    </span>
  )
}
