import { useMemo } from 'react'
import { useMembers } from '@/api/members'
import type { UserSummary } from '@/api/types'
import { useCurrentUser } from '@/auth/AuthProvider'
import { UserAvatar } from '@/components/issue'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Skeleton,
  Tooltip,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AssigneeFilterValue } from './model'

/** Avatars shown inline before the rest move into the "+n" menu. */
const MAX_INLINE = 5

/** Props of `AssigneeFilter`. */
export interface AssigneeFilterProps {
  projectKey: string
  value: readonly AssigneeFilterValue[]
  onChange: (value: AssigneeFilterValue[]) => void
}

/**
 * Jira-style assignee quick filters: overlapping member avatars (you first) that toggle, an
 * "Unassigned" toggle and a "+n" menu for the remaining members. Multiple selections are OR-ed.
 */
export function AssigneeFilter({ projectKey, value, onChange }: AssigneeFilterProps) {
  const me = useCurrentUser()
  const members = useMembers(projectKey)

  const users = useMemo(() => {
    const list = (members.data ?? []).map((m) => m.user)
    const mine = list.filter((u) => u.id === me.id)
    return [...mine, ...list.filter((u) => u.id !== me.id)]
  }, [members.data, me.id])

  const toggle = (v: AssigneeFilterValue) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  if (members.isPending) {
    return (
      <div className="flex items-center -space-x-1.5" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="size-8 rounded-full ring-2 ring-surface" />
        ))}
      </div>
    )
  }
  if (users.length === 0) return null

  const inline = users.slice(0, MAX_INLINE)
  const overflow = users.slice(MAX_INLINE)
  const overflowSelected = overflow.filter((u) => value.includes(u.id)).length

  return (
    <div role="group" aria-label="Filter by assignee" className="flex items-center" data-testid="backlog-assignee-filter">
      <div className="flex items-center -space-x-1.5 pr-1">
        {inline.map((u) => (
          <AvatarToggle
            key={u.id}
            user={u}
            label={u.id === me.id ? `${u.name} (you)` : u.name}
            pressed={value.includes(u.id)}
            onToggle={() => toggle(u.id)}
          />
        ))}
        <AvatarToggle user={null} label="Unassigned" pressed={value.includes('none')} onToggle={() => toggle('none')} />
      </div>
      {overflow.length > 0 && (
        <DropdownMenu>
          <Tooltip content={`${overflow.length} more ${overflow.length === 1 ? 'person' : 'people'}`}>
            <DropdownMenuTrigger
              aria-label={`More assignees${overflowSelected ? `, ${overflowSelected} selected` : ''}`}
              className={cn(
                '-ml-1.5 flex size-8 items-center justify-center rounded-full bg-neutral-subtle text-xs font-semibold text-fg-muted ring-2 ring-surface transition-colors hover:bg-surface-hover hover:text-fg',
                overflowSelected > 0 && 'ring-primary',
              )}
            >
              +{overflow.length}
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start">
            {overflow.map((u) => (
              <DropdownMenuCheckboxItem
                key={u.id}
                checked={value.includes(u.id)}
                onCheckedChange={() => toggle(u.id)}
                onSelect={(e) => e.preventDefault()}
              >
                <UserAvatar user={u} size="sm" showName />
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function AvatarToggle({
  user,
  label,
  pressed,
  onToggle,
}: {
  user: UserSummary | null
  label: string
  pressed: boolean
  onToggle: () => void
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onToggle}
        className={cn(
          'relative flex rounded-full ring-2 ring-surface transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10',
          pressed && 'z-10 ring-primary',
        )}
      >
        <UserAvatar user={user} size="lg" tooltip={false} emptyLabel="Unassigned" />
      </button>
    </Tooltip>
  )
}
