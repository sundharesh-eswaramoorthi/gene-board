import { LogOut, UserMinus, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMembers, useRemoveMember, useUpdateMember } from '@/api/members'
import type { ID, Member, Project, Role } from '@/api/types'
import { useCurrentUser } from '@/auth/AuthProvider'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Select'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/toast'
import { formatDate, formatShortDate } from '@/lib/dates'
import { errorMessage, isApiStatus } from '@/lib/errors'
import { pluralize } from '@/lib/format'
import { ROLE_META, ROLES } from '@/lib/issueMeta'
import { AddMemberForm } from './AddMemberForm'
import { SettingsSection } from './SettingsSection'
import { useLeaveProject } from './useProjectExit'

const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_META[role].label }))

const LAST_ADMIN_MESSAGE = 'A project needs at least one admin. Make someone else an admin first.'

/** Friendlier text for the "would leave no admin" conflict; other errors keep the server's message. */
function memberErrorMessage(err: unknown, fallback: string): string {
  return isApiStatus(err, 409) ? LAST_ADMIN_MESSAGE : errorMessage(err, fallback)
}

/** Props of {@link MembersTab}. */
export interface MembersTabProps {
  project: Project
  isAdmin: boolean
}

/**
 * Project members: admins add people by email, change roles and remove members; everyone can
 * leave. "Last admin" conflicts (409) are explained instead of failing silently.
 */
export function MembersTab({ project, isAdmin }: MembersTabProps) {
  const me = useCurrentUser()
  const members = useMembers(project.key)
  const updateMember = useUpdateMember(project.key)
  const removeMember = useRemoveMember(project.key)
  const leave = useLeaveProject(project.key, me.id)
  const confirm = useConfirm()
  const [pendingUserId, setPendingUserId] = useState<ID | null>(null)

  const list = useMemo(() => members.data ?? [], [members.data])
  const memberIds = useMemo(() => new Set(list.map((m) => m.user.id)), [list])
  const adminCount = list.filter((m) => m.role === 'admin').length

  const changeRole = async (member: Member, role: Role) => {
    if (role === member.role) return
    const isSelf = member.user.id === me.id
    if (member.role === 'admin' && adminCount <= 1) {
      toast.error(LAST_ADMIN_MESSAGE)
      return
    }
    if (isSelf && member.role === 'admin') {
      const ok = await confirm({
        title: 'Give up admin access?',
        description: `You’ll become a ${ROLE_META[role].label.toLowerCase()} and won’t be able to change these settings any more.`,
        confirmLabel: 'Change my role',
        tone: 'danger',
      })
      if (!ok) return
    }
    setPendingUserId(member.user.id)
    updateMember.mutate(
      { userId: member.user.id, role },
      {
        onSuccess: () =>
          toast.success(isSelf ? `You are now a ${ROLE_META[role].label.toLowerCase()}` : `${member.user.name} is now a ${ROLE_META[role].label.toLowerCase()}`),
        onError: (err) => toast.error(memberErrorMessage(err, 'Couldn’t change the role')),
        onSettled: () => setPendingUserId(null),
      },
    )
  }

  const remove = (member: Member) =>
    confirm({
      title: `Remove ${member.user.name}?`,
      description: `They’ll lose access to ${project.name}. Issues assigned to them in this project become unassigned.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        try {
          await removeMember.mutateAsync(member.user.id)
          toast.success(`${member.user.name} was removed from the project`)
        } catch (err) {
          throw new Error(memberErrorMessage(err, 'Couldn’t remove that member'))
        }
      },
    })

  const leaveProject = (member: Member) => {
    if (member.role === 'admin' && adminCount <= 1) {
      return confirm({
        title: 'You’re the only admin',
        description:
          list.length > 1
            ? 'Make another member an admin before leaving, so someone can still manage the project.'
            : 'You’re the last member of this project. Delete the project from the Details tab if it’s no longer needed.',
        confirmLabel: 'Got it',
        tone: 'primary',
      })
    }
    return confirm({
      title: `Leave ${project.name}?`,
      description: 'You’ll lose access to the project and its issues. Issues assigned to you become unassigned. An admin can add you back later.',
      confirmLabel: 'Leave project',
      onConfirm: async () => {
        try {
          await leave.mutateAsync()
          toast.success(`You left ${project.name}`)
        } catch (err) {
          throw new Error(memberErrorMessage(err, 'Couldn’t leave the project'))
        }
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {isAdmin && (
        <SettingsSection title="Add people" description="Invite existing Gene Board users by email and choose what they can do.">
          <AddMemberForm projectKey={project.key} memberIds={memberIds} />
        </SettingsSection>
      )}

      <SettingsSection
        title="Members"
        description={members.data ? pluralize(list.length, 'person', 'people') + ' can access this project.' : undefined}
        bodyClassName="px-0 pb-0"
      >
        {members.isPending ? (
          <SkeletonRows rows={4} className="border-t border-border" />
        ) : members.isLoadingError ? (
          <ErrorState size="sm" error={members.error} title="Couldn’t load members" onRetry={() => void members.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState size="sm" icon={<UsersRound />} title="No members" />
        ) : (
          <ul className="divide-y divide-border border-t border-border" data-testid="members-list">
            {list.map((member) => {
              const isSelf = member.user.id === me.id
              const isLead = project.lead?.id === member.user.id
              const busy = pendingUserId === member.user.id
              return (
                <li
                  key={member.user.id}
                  className="grid grid-cols-[minmax(0,1fr)_7.5rem_5.5rem] items-center gap-x-3 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_6.5rem_8rem_5.5rem]"
                  data-testid={`member-${member.user.id}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar user={member.user} size="lg" tooltip={false} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                        <span className="truncate">{member.user.name}</span>
                        {isSelf && <Badge tone="primary">You</Badge>}
                        {isLead && <Badge tone="neutral">Lead</Badge>}
                      </p>
                      <p className="truncate text-xs text-fg-muted">{member.user.email}</p>
                    </div>
                  </div>
                  <p className="hidden text-xs whitespace-nowrap text-fg-subtle lg:block" title={formatDate(member.joinedAt)}>
                    Joined {formatShortDate(member.joinedAt)}
                  </p>
                  <div className="min-w-0">
                    {isAdmin ? (
                      <Select
                        size="sm"
                        aria-label={`Role of ${member.user.name}`}
                        value={member.role}
                        disabled={busy}
                        options={ROLE_OPTIONS}
                        onChange={(e) => void changeRole(member, e.target.value as Role)}
                      />
                    ) : (
                      <Badge
                        tone={member.role === 'admin' ? 'primary' : 'neutral'}
                        variant={member.role === 'viewer' ? 'outline' : 'subtle'}
                        shape="square"
                      >
                        {ROLE_META[member.role].label}
                      </Badge>
                    )}
                  </div>
                  <div className="flex justify-end">
                    {isSelf ? (
                      <Button size="sm" variant="subtle" icon={<LogOut />} onClick={() => void leaveProject(member)}>
                        Leave
                      </Button>
                    ) : isAdmin ? (
                      <IconButton
                        size="sm"
                        variant="danger"
                        label={`Remove ${member.user.name}`}
                        tooltip="Remove from project"
                        icon={<UserMinus />}
                        onClick={() => void remove(member)}
                      />
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </SettingsSection>
    </div>
  )
}
