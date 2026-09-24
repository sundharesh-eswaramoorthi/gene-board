import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '@/api/client'
import { safeNextPath, useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { errorMessage } from '@/lib/errors'
import { AuthLayout, FormAlert, isEmail, PasswordInput } from './AuthLayout'

const DEMO = { email: 'demo@geneboard.dev', password: 'password123' }

/** `/login` — email + password sign-in; redirects to `?next=` afterwards. */
export function LoginPage() {
  const { login, endedBy } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const next = params.get('next')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => navigate(safeNextPath(next), { replace: true }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!email.trim()) nextErrors.email = 'Enter your email'
    else if (!isEmail(email)) nextErrors.email = 'Enter a valid email address'
    if (!password) nextErrors.password = 'Enter your password'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length === 0) mutation.mutate({ email, password })
  }

  const serverError = mutation.error
  const serverFields = serverError instanceof ApiError ? serverError.fields : undefined
  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : '/register'

  return (
    <AuthLayout
      title="Log in to Gene Board"
      subtitle="Welcome back — pick up where you left off."
      footer={
        <>
          New to Gene Board?{' '}
          <Link to={registerHref} className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {endedBy === 'expired' && next && !serverError && (
          <FormAlert tone="info">Your session has expired. Log in again to continue.</FormAlert>
        )}
        {serverError && !serverFields && <FormAlert>{errorMessage(serverError)}</FormAlert>}
        <Field label="Email" error={errors.email ?? serverFields?.email}>
          <Input
            type="email"
            size="lg"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" error={errors.password ?? serverFields?.password}>
          <PasswordInput
            size="lg"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={mutation.isPending} className="mt-2">
          Log in
        </Button>
        {import.meta.env.DEV && (
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              setEmail(DEMO.email)
              setPassword(DEMO.password)
              setErrors({})
            }}
          >
            Fill in the demo account
          </Button>
        )}
      </form>
    </AuthLayout>
  )
}
