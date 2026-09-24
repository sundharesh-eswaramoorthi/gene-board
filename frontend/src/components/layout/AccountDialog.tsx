import { useState, type FormEvent } from 'react'
import { useUpdateMe } from '@/api/auth'
import type { UpdateMeInput } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { toast } from '@/components/ui/toast'
import { charCount } from '@/lib/chars'
import { errorMessage, fieldErrors } from '@/lib/errors'

/** Account settings: display name and password change (PATCH /auth/me). Mount it only while open so it starts fresh. */
export function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  const update = useUpdateMe()
  const [name, setName] = useState(user?.name ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    const input: UpdateMeInput = {}
    const trimmed = name.trim()
    if (!trimmed) next.name = 'Name is required'
    else if (charCount(trimmed) > 100) next.name = 'Name must be at most 100 characters'
    else if (trimmed !== user?.name) input.name = trimmed
    if (currentPassword || newPassword || confirmPassword) {
      if (!currentPassword) next.currentPassword = 'Enter your current password'
      if (newPassword.length < 8) next.newPassword = 'Use at least 8 characters'
      if (newPassword !== confirmPassword) next.confirmPassword = 'Passwords don’t match'
      input.currentPassword = currentPassword
      input.newPassword = newPassword
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    if (Object.keys(input).length === 0) {
      onOpenChange(false)
      return
    }
    try {
      await update.mutateAsync(input)
      toast.success('Account updated')
      onOpenChange(false)
    } catch (err) {
      const fields = fieldErrors(err)
      if (Object.keys(fields).length > 0) setErrors(fields)
      else toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Account settings"
      description={user?.email}
      size="sm"
      onSubmit={onSubmit}
      footer={
        <>
          <Button variant="subtle" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <UserAvatar user={user ? { id: user.id, name: name || user.name } : null} size="xl" tooltip={false} />
          <div className="min-w-0 text-sm">
            <p className="truncate font-semibold">{name || user?.name}</p>
            <p className="truncate text-fg-muted">{user?.email}</p>
          </div>
        </div>
        <Field label="Full name" required error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
        </Field>
        <div className="border-t border-border pt-4">
          <p className="mb-3 text-sm font-semibold">Change password</p>
          <div className="flex flex-col gap-3">
            <Field label="Current password" error={errors.currentPassword}>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="New password" hint="At least 8 characters" error={errors.newPassword}>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm new password" error={errors.confirmPassword}>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
