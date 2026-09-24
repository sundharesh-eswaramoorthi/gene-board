import { useQueryClient } from '@tanstack/react-query'
import { ServerCrash } from 'lucide-react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { loginRequest, registerRequest, useMe } from '@/api/auth'
import { ApiError, onSessionTokenReplaced, onUnauthorized, TOKEN_STORAGE_KEY, tokenStorage } from '@/api/client'
import { qk } from '@/api/queryKeys'
import type { LoginInput, RegisterInput, User } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'

/**
 * - `loading`: a token exists and /auth/me is in flight
 * - `authenticated`: user loaded
 * - `anonymous`: no (valid) token
 * - `error`: a token exists but the server couldn't be reached to verify it
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error'

/** Value of useAuth(). */
export interface AuthContextValue {
  status: AuthStatus
  /** The signed-in user (null unless authenticated). */
  user: User | null
  token: string | null
  /** Why the last session ended: explicit logout or an expired/invalid token (401). */
  endedBy: 'logout' | 'expired' | null
  /** POST /auth/login; stores the token. Rejects with ApiError (401 → "Invalid email or password"). */
  login: (input: LoginInput) => Promise<User>
  /** POST /auth/register; signs the new user in. Rejects with ApiError (409 email taken). */
  register: (input: RegisterInput) => Promise<User>
  /** Clears the session and all cached data. */
  logout: () => void
  /** Retry /auth/me after a server error. */
  retry: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Session state: JWT in localStorage (`gb-token`), user from GET /auth/me. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [token, setToken] = useState<string | null>(() => tokenStorage.get())
  const [endedBy, setEndedBy] = useState<AuthContextValue['endedBy']>(null)
  const me = useMe({ enabled: !!token, retry: 1 })

  // A 401 anywhere (except login/register) ends the session.
  useEffect(
    () =>
      onUnauthorized(() => {
        setToken(null)
        setEndedBy('expired')
        qc.clear()
      }),
    [qc],
  )

  // A token re-issued for the same user (account update) replaces the current one in place.
  useEffect(() => onSessionTokenReplaced(setToken), [])

  // Keep tabs in sync: logging in/out elsewhere switches this tab too.
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOKEN_STORAGE_KEY && e.key !== null) return
      const next = tokenStorage.get()
      if (next === tokenRef.current) return
      qc.clear()
      if (!next) setEndedBy('logout')
      setToken(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [qc])

  const signIn = useCallback(
    (newToken: string, user: User) => {
      qc.clear()
      tokenStorage.set(newToken)
      qc.setQueryData(qk.me(), user)
      setEndedBy(null)
      setToken(newToken)
      return user
    },
    [qc],
  )

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await loginRequest({ email: input.email.trim(), password: input.password })
      return signIn(res.token, res.user)
    },
    [signIn],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await registerRequest({ ...input, email: input.email.trim(), name: input.name.trim() })
      return signIn(res.token, res.user)
    },
    [signIn],
  )

  const logout = useCallback(() => {
    tokenStorage.clear()
    setEndedBy('logout')
    setToken(null)
    qc.clear()
  }, [qc])

  const { refetch } = me
  const retry = useCallback(() => void refetch(), [refetch])

  let status: AuthStatus
  if (!token) status = 'anonymous'
  else if (me.data) status = 'authenticated'
  else if (me.isError) status = me.error instanceof ApiError && me.error.status === 401 ? 'anonymous' : 'error'
  else status = 'loading'

  const user = token ? (me.data ?? null) : null
  const value = useMemo<AuthContextValue>(
    () => ({ status, user, token, endedBy, login, register, logout, retry }),
    [status, user, token, endedBy, login, register, logout, retry],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

/** Session state and actions; must be used under AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

/** The signed-in user; throws when used outside an authenticated route. */
export function useCurrentUser(): User {
  const { user } = useAuth()
  if (!user) throw new Error('useCurrentUser requires an authenticated session (inside <RequireAuth>)')
  return user
}

/** Control characters (URL parsers drop tabs/newlines: `/\t/evil.com` is `//evil.com`) and backslashes. */
// oxlint-disable-next-line no-control-regex
const UNSAFE_NEXT_CHARS = /[\u0000-\u001f\u007f\\]/

/**
 * Only allow same-origin paths as post-login redirect targets. The value is resolved the way
 * the browser would resolve it and must stay on this origin; anything odd falls back to `/`.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || UNSAFE_NEXT_CHARS.test(next)) return '/'
  let url: URL
  try {
    url = new URL(next, window.location.origin)
  } catch {
    return '/'
  }
  if (url.origin !== window.location.origin) return '/'
  if (/^\/(login|register)(\/|$)/.test(url.pathname)) return '/'
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Route guard: renders children for signed-in users; otherwise redirects to
 * `/login?next=<current path>` (plain `/login` after an explicit logout).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, endedBy, retry } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'error') {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <EmptyState
          icon={<ServerCrash />}
          title="Can’t reach Gene Board"
          description="The server isn’t responding. Check that the API is running, then try again."
          action={<Button onClick={retry}>Try again</Button>}
        />
      </div>
    )
  }
  if (status === 'anonymous') {
    const here = `${location.pathname}${location.search}${location.hash}`
    const to = endedBy === 'logout' || here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`
    return <Navigate to={to} replace />
  }
  return <>{children}</>
}

/** Wraps login/register: signed-in users are sent to `?next=` (or home). */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'authenticated') {
    const next = new URLSearchParams(location.search).get('next')
    return <Navigate to={safeNextPath(next)} replace />
  }
  if (status === 'loading') return <FullPageSpinner />
  return <>{children}</>
}
