import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

const SPINNER_SIZES = { xs: 'size-3', sm: 'size-4', md: 'size-5', lg: 'size-8' } as const

/** Props of `Spinner`. */
export interface SpinnerProps {
  size?: keyof typeof SPINNER_SIZES
  /** Accessible label (default "Loading"). */
  label?: string
  className?: string
}

/** Rotating loader icon; inherits text colour. */
export function Spinner({ size = 'sm', label = 'Loading', className }: SpinnerProps) {
  return (
    <LoaderCircle
      role="status"
      aria-label={label}
      className={cn('animate-spin text-current', SPINNER_SIZES[size], className)}
    />
  )
}

/** Spinner centred in its container (min height 10rem) with an optional caption. */
export function CenteredSpinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-40 flex-col items-center justify-center gap-3 text-fg-subtle', className)}>
      <Spinner size="md" label={label ?? 'Loading'} />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}

/** Full-viewport loading screen (auth bootstrap, lazy routes). */
export function FullPageSpinner({ label }: { label?: string }) {
  return <CenteredSpinner label={label} className="h-dvh min-h-0 bg-bg" />
}
