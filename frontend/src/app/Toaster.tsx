import type { CSSProperties } from 'react'
import { Toaster as SonnerToaster } from 'sonner'
import { useTheme } from './ThemeProvider'

/** Sonner toaster themed with the design tokens (bottom-left, like Jira flags). */
export function Toaster() {
  const { resolvedTheme } = useTheme()
  return (
    <SonnerToaster
      theme={resolvedTheme}
      position="bottom-left"
      closeButton
      richColors
      visibleToasts={4}
      toastOptions={{ className: 'font-sans text-sm shadow-overlay!' }}
      style={
        {
          '--normal-bg': 'var(--surface-raised)',
          '--normal-text': 'var(--fg)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--surface-raised)',
          '--success-text': 'var(--success)',
          '--success-border': 'var(--border)',
          '--error-bg': 'var(--surface-raised)',
          '--error-text': 'var(--danger)',
          '--error-border': 'var(--border)',
          '--warning-bg': 'var(--surface-raised)',
          '--warning-text': 'var(--warning)',
          '--warning-border': 'var(--border)',
          '--info-bg': 'var(--surface-raised)',
          '--info-text': 'var(--info)',
          '--info-border': 'var(--border)',
          '--border-radius': '8px',
        } as CSSProperties
      }
    />
  )
}
