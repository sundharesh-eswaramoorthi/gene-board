import { Mail, UserPlus } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { useAddMember } from '@/api/members'
import { useUsers } from '@/api/users'
import type { ID, Role } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { toast, toastError } from '@/components/ui/toast'
import { fieldErrors, isApiStatus } from '@/lib/errors'
import { useDebouncedValue } from '@/lib/hooks'
import { ROLE_META, ROLES } from '@/lib/issueMeta'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_META[role].label }))

/** Props of {@link AddMemberForm}. */
export interface AddMemberFormProps {
  projectKey: string
  /** User ids already in the project (hidden from suggestions). */
  memberIds: ReadonlySet<ID>
}

/**
 * Add a person by email with a role. Suggests matching users while typing; reports an unknown
 * email (404) or an existing member (409) on the email field.
 */
export function AddMemberForm({ projectKey, memberIds }: AddMemberFormProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [error, setError] = useState<string | null>(null)
  const add = useAddMember(projectKey)
  const listId = useId()

  const query = useDebouncedValue(email.trim(), 200)
  const users = useUsers(query, { limit: 8, enabled: query.length >= 2 })
  const suggestions = useMemo(
    () => (query.length >= 2 ? (users.data ?? []).filter((u) => !memberIds.has(u.id)) : []),
    [users.data, memberIds, query],
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) return setError('Enter the email address of the person to add')
    if (!EMAIL_PATTERN.test(value)) return setError('That doesn’t look like an email address')
    add.mutate(
      { email: value, role },
      {
        onSuccess: (member) => {
          toast.success(`${member.user.name} was added as ${ROLE_META[member.role].label.toLowerCase()}`)
          setEmail('')
          setError(null)
        },
        onError: (err) => {
          if (isApiStatus(err, 404)) setError('No user with that email. They need to sign up for Gene Board first.')
          else if (isApiStatus(err, 409)) setError('That person is already a member of this project.')
          else {
            const fields = fieldErrors(err)
            if (fields.email) setError(`Email ${fields.email}`)
            else if (fields.role) setError(`Role ${fields.role}`)
            else toastError(err, 'Couldn’t add that person')
          }
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2" data-testid="add-member-form">
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <Field label="Email" error={error ?? undefined}>
          <Input
            type="email"
            list={listId}
            value={email}
            autoComplete="off"
            placeholder="name@company.com"
            leadingIcon={<Mail />}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            data-testid="add-member-email"
          />
        </Field>
        <datalist id={listId}>
          {suggestions.map((u) => (
            <option key={u.id} value={u.email}>
              {u.name}
            </option>
          ))}
        </datalist>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} options={ROLE_OPTIONS} data-testid="add-member-role" />
        </Field>
        <Button type="submit" variant="primary" icon={<UserPlus />} loading={add.isPending} className="sm:mt-[1.375rem]">
          Add
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">
        <span className="font-medium text-fg-muted">{ROLE_META[role].label}:</span> {ROLE_META[role].description}
      </p>
    </form>
  )
}
