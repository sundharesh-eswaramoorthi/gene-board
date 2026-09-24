import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { API_BASE } from '@/api/client'
import { refreshProject } from '@/api/invalidate'
import { qk } from '@/api/queryKeys'
import type { RealtimeEvent } from '@/api/types'
import { useAuth } from '@/auth/AuthProvider'

const DEBOUNCE_MS = 300
const MAX_WAIT_MS = 1500
const BASE_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000
/** Close code the server uses once the token or the project access was revoked. */
const CLOSE_POLICY_VIOLATION = 1008

function socketUrl(projectKey: string, token: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}${API_BASE}/projects/${encodeURIComponent(projectKey)}/ws?token=${encodeURIComponent(token)}`
}

function parseEvent(data: unknown): RealtimeEvent | null {
  if (typeof data !== 'string') return null
  try {
    const parsed = JSON.parse(data) as Partial<RealtimeEvent>
    return typeof parsed.type === 'string' ? (parsed as RealtimeEvent) : null
  } catch {
    return null
  }
}

/**
 * Live updates for a project: opens `/api/projects/{key}/ws?token=…` and treats every event as
 * a cache-invalidation hint — `['project', KEY]`, `['issues']`, `['activity']` and other
 * projects' issue details (they show linked issues) are refreshed with `refreshProject`, which
 * never cancels a refetch already running (debounced ~300ms; `['projects']` too for project
 * changes). Reconnects with exponential backoff (1s → 30s, jittered) and refreshes after
 * reconnecting to catch missed events. A socket the server closed for policy reasons, or one
 * that never opened, triggers a request that signs out a session that has ended. Closes on
 * unmount / key change. Mounted by ProjectLayout.
 */
export function useProjectRealtime(projectKey: string | null | undefined): void {
  const qc = useQueryClient()
  const { token } = useAuth()

  useEffect(() => {
    if (!projectKey || !token || typeof WebSocket === 'undefined') return
    const key = projectKey.toUpperCase()

    let socket: WebSocket | null = null
    let disposed = false
    let attempt = 0
    let reconnectTimer: number | undefined
    let debounceTimer: number | undefined
    let firstPendingAt = 0
    let refreshProjects = false

    const flush = () => {
      debounceTimer = undefined
      firstPendingAt = 0
      const projects = refreshProjects
      refreshProjects = false
      void refreshProject(qc, key, { projects, linkedIssues: true })
    }

    const schedule = () => {
      const now = Date.now()
      if (!firstPendingAt) firstPendingAt = now
      window.clearTimeout(debounceTimer)
      const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstPendingAt + MAX_WAIT_MS - now))
      debounceTimer = window.setTimeout(flush, wait)
    }

    const connect = () => {
      if (disposed) return
      const ws = new WebSocket(socketUrl(key, token))
      socket = ws
      let opened = false
      ws.onopen = () => {
        opened = true
        // After a reconnect we may have missed events: refresh once.
        if (attempt > 0) schedule()
        attempt = 0
      }
      ws.onmessage = (message) => {
        const event = parseEvent(message.data)
        if (!event) return
        if (event.projectKey && event.projectKey.toUpperCase() !== key) return
        if (event.type === 'project.changed') refreshProjects = true
        schedule()
      }
      ws.onclose = (event) => {
        if (socket === ws) socket = null
        if (disposed) return
        // Reconnecting with the same token cannot revive a session that has ended (password
        // changed elsewhere, token expired), and an idle board makes no other request that
        // would notice. So ask the API, where a 401 signs out. On 1008 (the server found the
        // token or the project access revoked) refresh the project: 401 signs out, 404 shows
        // "not found". A socket that never opened may have been refused for the same reasons
        // (browsers hide the handshake's status): check the session, a cheap request.
        if (event.code === CLOSE_POLICY_VIOLATION) schedule()
        else if (!opened) void qc.invalidateQueries({ queryKey: qk.me() })
        const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** attempt) * (0.8 + Math.random() * 0.4)
        attempt += 1
        reconnectTimer = window.setTimeout(connect, delay)
      }
      // Errors are followed by a close event, which drives the reconnect.
      ws.onerror = () => undefined
    }

    // Defer so React StrictMode's mount/unmount/mount doesn't open and abort a socket.
    reconnectTimer = window.setTimeout(connect, 0)

    return () => {
      disposed = true
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(debounceTimer)
      if (socket) {
        socket.onclose = null
        socket.onmessage = null
        socket.onopen = null
        if (socket.readyState === WebSocket.CONNECTING) {
          const pending = socket
          pending.onopen = () => pending.close(1000)
        } else {
          socket.close(1000)
        }
        socket = null
      }
    }
  }, [projectKey, token, qc])
}
