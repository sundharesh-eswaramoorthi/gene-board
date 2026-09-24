import type { ApiErrorBody, ApiErrorCode } from './types'

/** localStorage key holding the JWT. */
export const TOKEN_STORAGE_KEY = 'gb-token'

/** Base path of the Go API (proxied by Vite in development). */
export const API_BASE = '/api'

/** Error thrown for every non-2xx response (and for network failures, with status 0). */
export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly fields?: Record<string, string>

  constructor(status: number, code: ApiErrorCode, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }

  /** 404 — the resource does not exist or the caller is not a project member. */
  get isNotFound(): boolean {
    return this.status === 404
  }

  /** 403 — the caller's project role is insufficient. */
  get isForbidden(): boolean {
    return this.status === 403
  }

  /** 409 — conflict (duplicate key, last admin, active sprint exists, ...). */
  get isConflict(): boolean {
    return this.status === 409
  }
}

// This page's copy of the token. localStorage stays the source of truth while it can be read
// (so a token another tab stored is seen at once). If it can't be read (site data blocked) the
// copy is all there is and the session lasts for this page only; if only a write failed
// (storage full) the copy wins until storage holds something else (another tab signed in/out).
let pageToken: string | null = null
let storageReadable = true
// What storage held when this page's last write to it failed (undefined: no write failed).
let unsavedOver: string | null | undefined

function readStored(): string | null | undefined {
  if (!storageReadable) return undefined
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    storageReadable = false
    return undefined
  }
}

function writeStored(token: string | null): void {
  pageToken = token
  try {
    if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY)
    else localStorage.setItem(TOKEN_STORAGE_KEY, token)
    unsavedOver = undefined
  } catch {
    unsavedOver = readStored()
  }
}

/** Reads / writes the session JWT. All access is guarded (storage can be unavailable). */
export const tokenStorage = {
  get(): string | null {
    const stored = readStored()
    if (stored === undefined || stored === unsavedOver) return pageToken
    unsavedOver = undefined
    pageToken = stored
    return stored
  },
  set(token: string): void {
    writeStored(token)
  },
  clear(): void {
    writeStored(null)
  },
}

type TokenListener = (token: string) => void
const tokenListeners = new Set<TokenListener>()

/**
 * Switch the session to a new token the server issued for the signed-in user. Stored at once so
 * every following request uses it; subscribers (AuthProvider) update their state.
 */
function replaceSessionToken(token: string): void {
  tokenStorage.set(token)
  for (const listener of tokenListeners) listener(token)
}

// Session changes in flight on this page (see patchSession).
const sessionChanges = new Set<Promise<unknown>>()

/**
 * PATCH a request whose answer re-issues the session token (`{ token, ... }`: PATCH /auth/me;
 * after a password change every older token is revoked) and switch the session to that token
 * before resolving. While it is in flight, a request that gets a 401 for the current token
 * waits for it: the change may be what revoked that token.
 */
export function patchSession<T extends { token: string }>(path: string, body: unknown): Promise<T> {
  const change = request<T>('PATCH', path, { body, changesSession: true }).then((res) => {
    replaceSessionToken(res.token)
    return res
  })
  const settled = () => void sessionChanges.delete(change)
  sessionChanges.add(change)
  void change.then(settled, settled)
  return change
}

/**
 * Subscribe to the session switching to a re-issued token ({@link patchSession}). Returns an
 * unsubscribe function.
 */
export function onSessionTokenReplaced(listener: TokenListener): () => void {
  tokenListeners.add(listener)
  return () => {
    tokenListeners.delete(listener)
  }
}

type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

/**
 * Subscribe to "session expired" (a 401 from any endpoint except login/register, for the token
 * that is still the current one). The client has already cleared the stored token when
 * listeners run. Returns an unsubscribe function.
 */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

/** Query-string values: arrays are comma-joined, `null`/`undefined`/`''` are dropped. */
export type QueryParamValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | null
  | undefined
/** Query-string parameters for `api.get` / `api.delete`. */
export type QueryParams = Record<string, QueryParamValue>

/** Build `/api<path>?<query>` from a path relative to `/api` and optional params. */
export function buildUrl(path: string, params?: QueryParams): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  if (!params) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      search.set(key, value.join(','))
    } else {
      search.set(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/** Per-request options. */
export interface RequestOptions {
  /** Abort signal (TanStack Query passes one to every queryFn). */
  signal?: AbortSignal
}

const AUTH_ENDPOINTS = new Set(['/auth/login', '/auth/register'])

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object' &&
    (value as { error: unknown }).error !== null
  )
}

function codeForStatus(status: number): ApiErrorCode {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  return 'internal'
}

function defaultMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Your session has expired. Please log in again.'
    case 403:
      return 'You don’t have permission to do that.'
    case 404:
      return 'Not found.'
    case 409:
      return 'That conflicts with the current state. Refresh and try again.'
    case 429:
      return 'Too many attempts. Wait a moment and try again.'
    case 502:
    case 503:
    case 504:
      return 'The server is unavailable. Please try again shortly.'
    default:
      return status >= 500 ? 'Something went wrong on our side.' : `Request failed (${status}).`
  }
}

interface RequestArgs {
  params?: QueryParams
  body?: unknown
  signal?: AbortSignal
  /** Sent by {@link patchSession}: its own 401 doesn't wait for the session change it is. */
  changesSession?: boolean
}

async function request<T>(method: string, path: string, init: RequestArgs = {}, retried = false): Promise<T> {
  const { params, body, signal } = init
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = tokenStorage.get()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'network_error', 'Can’t reach the server. Check your connection and try again.')
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !AUTH_ENDPOINTS.has(path)) {
      let current = tokenStorage.get()
      if (current === token && sessionChanges.size > 0 && !init.changesSession) {
        // A session change in flight (a password change) may be what revoked this token: wait
        // until it has stored the new one, then go by the token it left.
        await Promise.allSettled(sessionChanges)
        current = tokenStorage.get()
      }
      if (current === token) {
        tokenStorage.clear()
        for (const listener of unauthorizedListeners) listener()
      } else if (current && !retried) {
        // The session moved on while this request was in flight (a password change re-issued
        // the token, maybe in another tab): the 401 is about the old token, so don't end the
        // new session over it; send the request again with the current token.
        return request<T>(method, path, init, true)
      }
    }
    if (isErrorBody(data)) {
      const { code, message, fields } = data.error
      throw new ApiError(
        response.status,
        code ?? codeForStatus(response.status),
        message || defaultMessage(response.status),
        fields ?? undefined,
      )
    }
    throw new ApiError(response.status, codeForStatus(response.status), defaultMessage(response.status))
  }

  if (data === undefined && text) {
    throw new ApiError(response.status, 'internal', 'The server sent an unreadable response.')
  }
  return data as T
}

/**
 * Typed fetch wrapper for the Gene Board API. Paths are relative to `/api`:
 * `api.get<Project[]>('/projects')`. Adds the bearer token, throws {@link ApiError} for
 * non-2xx responses, resolves `undefined` for 204.
 */
export const api = {
  get<T>(path: string, params?: QueryParams, options?: RequestOptions): Promise<T> {
    return request<T>('GET', path, { params, signal: options?.signal })
  },
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', path, { body, signal: options?.signal })
  },
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, { body, signal: options?.signal })
  },
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, { body, signal: options?.signal })
  },
  delete(path: string, params?: QueryParams, options?: RequestOptions): Promise<void> {
    return request<void>('DELETE', path, { params, signal: options?.signal })
  },
}

/** URL-encode a single path segment (`/projects/${seg(key)}`). */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value))
}
