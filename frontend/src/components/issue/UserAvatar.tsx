import { UserRound } from 'lucide-react'
import type { UserSummary } from '@/api/types'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { avatarColor, initials } from '@/lib/colors'

const SIZES = {
  xs: 'size-4 text-[7px] [&_svg]:size-2.5',
  sm: 'size-5 text-[8px] [&_svg]:size-3',
  md: 'size-6 text-[10px] [&_svg]:size-3.5',
  lg: 'size-8 text-xs [&_svg]:size-4',
  xl: 'size-10 text-sm [&_svg]:size-5',
} as const

/** Avatar size preset (16 / 20 / 24 / 32 / 40px). */
export type AvatarSize = keyof typeof SIZES

/** Props of `UserAvatar`. */
export interface UserAvatarProps {
  /** `null` renders the "Unassigned" placeholder. */
  user: Pick<UserSummary, 'id' | 'name'> | null | undefined
  size?: AvatarSize
  /** Render the name next to the avatar. */
  showName?: boolean
  /** Tooltip with the name (default: when the name isn't shown). */
  tooltip?: boolean
  /** Label for `null` users. */
  emptyLabel?: string
  className?: string
}

/** Round initials avatar with a deterministic colour per user; `null` → "Unassigned". */
export function UserAvatar({
  user,
  size = 'md',
  showName = false,
  tooltip = !showName,
  emptyLabel = 'Unassigned',
  className,
}: UserAvatarProps) {
  const name = user?.name ?? emptyLabel
  const circle = user ? (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold text-white select-none',
        SIZES[size],
        !showName && className,
      )}
      style={{ backgroundColor: avatarColor(user.id) }}
    >
      {initials(user.name)}
    </span>
  ) : (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong bg-surface-sunken text-fg-subtle',
        SIZES[size],
        !showName && className,
      )}
    >
      <UserRound aria-hidden />
    </span>
  )

  if (showName) {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
        {circle}
        <span className={cn('truncate', !user && 'text-fg-muted')}>{name}</span>
      </span>
    )
  }
  return tooltip ? <Tooltip content={name}>{circle}</Tooltip> : circle
}
