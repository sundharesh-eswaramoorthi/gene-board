import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '@/api/client'
import { safeNextPath, useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { charCount } from '@/lib/chars'
import { errorMessage } from '@/lib/errors'
import { AuthLayout, FormAlert, isEmail, PasswordInput } from './AuthLayout'

type FieldName = 'name' | 'email' | 'password'

/** `/register` — create an account (name, email, password ≥ 8) and sign in. */
export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = new URLSearchParams(location.search).get('next')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})

  const mutation = useMutation({
    mutationFn: register,
    onSuccess: () => navigate(safeNextPath(next), { replace: true }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setErrors({ email: 'An account with this email already exists' })
      } else if (err instanceof ApiError && err.fields) {
        setErrors(err.fields as Partial<Record<FieldName, string>>)
      }
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    const n = name.trim()
    if (!n) nextErrors.name = 'Enter your name'
    else if (charCount(n) > 100) nextErrors.name = 'Name must be at most 100 characters'
    if (!email.trim()) nextErrors.email = 'Enter your email'
    else if (!isEmail(email)) nextErrors.email = 'Enter a valid email address'
    if (password.length < 8) nextErrors.password = 'Use at least 8 characters'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length === 0) mutation.mutate({ name: n, email, password })
  }

  const err = mutation.error
  const showBanner = err && !(err instanceof ApiError && (err.status === 409 || err.fields))
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start planning and tracking work with your team."
      footer={
        <>
          Already have an account?{' '}
          <Link to={loginHref} className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {showBanner && <FormAlert>{errorMessage(err)}</FormAlert>}
        <Field label="Full name" error={errors.name}>
          <Input
            size="lg"
            autoComplete="name"
            autoFocus
            placeholder="Alex Morgan"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Work email" error={errors.email}>
          <Input
            type="email"
            size="lg"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" hint="At least 8 characters" error={errors.password}>
          <PasswordInput
            size="lg"
            autoComplete="new-password"
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={mutation.isPending} className="mt-2">
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
