import { useMemo } from 'react'
import type { ID, UserSummary } from '@/api/types'
import { useMembers } from '@/api/members'
import { useAuth } from '@/auth/AuthProvider'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { PickerTrigger, type PickerCommonProps } from './PickerTrigger'
import { UserAvatar, type AvatarSize } from './UserAvatar'

const NONE = -1

/** Props of `UserPicker`. */
export interface UserPickerProps extends PickerCommonProps {
  projectKey: string
  /** Selected user id, or the UserSummary itself (displayed even before members load). */
  value: ID | UserSummary | null
  onChange: (userId: ID | null, user: UserSummary | null) => void
  /** Offer the "Unassigned" option (default true). */
  allowUnassigned?: boolean
  /** Text for the empty option / empty value (default "Unassigned"). */
  unassignedLabel?: string
  /** Avatar size in the trigger (default `sm`; `compact` uses `md`). */
  avatarSize?: AvatarSize
}

/**
 * Project-member picker (searchable by name/email) with an optional "Unassigned" entry.
 * `compact` renders only the avatar — ideal on cards and rows.
 */
export function UserPicker({
  projectKey,
  value,
  onChange,
  allowUnassigned = true,
  unassignedLabel = 'Unassigned',
  avatarSize,
  variant = 'field',
  disabled,
  placeholder,
  className,
  trigger,
  align,
  open,
  onOpenChange,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: UserPickerProps) {
  const { user: me } = useAuth()
  const members = useMembers(projectKey)
  const valueId = typeof value === 'number' ? value : (value?.id ?? null)
  const current: UserSummary | null =
    members.data?.find((m) => m.user.id === valueId)?.user ?? (typeof value === 'object' ? value : null)

  const emptyText = placeholder ?? unassignedLabel
  const triggerEl = trigger ?? (
    <PickerTrigger
      variant={variant}
      disabled={disabled}
      className={className}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? `${current ? current.name : emptyText}`}
    >
      {variant === 'compact' ? (
        <UserAvatar user={current} size={avatarSize ?? 'md'} tooltip={false} emptyLabel={emptyText} />
      ) : (
        <UserAvatar user={current} size={avatarSize ?? 'sm'} showName emptyLabel={emptyText} />
      )}
    </PickerTrigger>
  )
  const options = useMemo(() => {
    const list: ComboboxOption<ID>[] = []
    if (allowUnassigned) {
      list.push({ value: NONE, label: unassignedLabel, icon: <UserAvatar user={null} size="sm" tooltip={false} /> })
    }
    for (const m of members.data ?? []) {
      list.push({
        value: m.user.id,
        label: m.user.name,
        keywords: m.user.email,
        icon: <UserAvatar user={m.user} size="sm" tooltip={false} />,
        description: m.user.id === me?.id ? 'You' : undefined,
      })
    }
    return list
  }, [members.data, allowUnassigned, unassignedLabel, me?.id])

  if (disabled) return triggerEl

  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={valueId ?? NONE}
      searchable
      searchPlaceholder="Search people…"
      loading={members.isLoading}
      emptyText="No matching people"
      width={280}
      align={align}
      open={open}
      onOpenChange={onOpenChange}
      aria-label="People"
      onSelect={(o) => {
        const nextId = o.value === NONE ? null : o.value
        if (nextId === valueId) return
        const user = members.data?.find((m) => m.user.id === nextId)?.user ?? null
        onChange(nextId, user)
      }}
    />
  )
}
