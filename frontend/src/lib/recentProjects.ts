import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'gb-recent-projects'
const EVENT = 'gb-recent-projects-change'
const MAX = 10

let cache: { raw: string | null; keys: string[] } = { raw: null, keys: [] }

function read(): string[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  if (raw === cache.raw) return cache.keys
  let keys: string[] = []
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    keys = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    keys = []
  }
  cache = { raw, keys }
  return keys
}

/** Remember a visited project (most recent first, max 10). Called by ProjectLayout. */
export function recordRecentProject(projectKey: string): void {
  const key = projectKey.toUpperCase()
  const next = [key, ...read().filter((k) => k !== key)].slice(0, MAX)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && onChange()
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** Project keys this browser visited recently, most recent first (may include deleted projects — intersect with useProjects()). */
export function useRecentProjectKeys(): string[] {
  return useSyncExternalStore(subscribe, read, () => [])
}
