import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

/** User preference; `system` follows the OS setting. */
export type Theme = 'light' | 'dark' | 'system'
/** The theme actually applied. */
export type ResolvedTheme = 'light' | 'dark'

/** localStorage key for the theme preference. */
export const THEME_STORAGE_KEY = 'gb-theme'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

function readStoredTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY)
    return t === 'light' || t === 'dark' || t === 'system' ? t : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement
  const dark = resolved === 'dark'
  if (root.classList.contains('dark') === dark && root.style.colorScheme === resolved) return
  // Switch in one frame: otherwise every element with a colour transition (buttons, cards,
  // columns) fades on its own and the page looks washed out while the theme changes.
  const freeze = document.createElement('style')
  freeze.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(freeze)
  root.classList.toggle('dark', dark)
  root.style.colorScheme = resolved
  void window.getComputedStyle(document.body).color // flush styles while transitions are off
  window.setTimeout(() => freeze.remove(), 1)
}

/**
 * Provides light / dark / system theming: toggles `.dark` on `<html>` and persists the
 * preference in localStorage (`gb-theme`). public/theme-init.js (loaded by index.html) applies it before first paint.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches)

  useEffect(() => {
    const mq = darkQuery()
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) setThemeState(readStoredTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  return <ThemeContext value={value}>{children}</ThemeContext>
}

/** `{ theme, resolvedTheme, setTheme }` — must be used under ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
