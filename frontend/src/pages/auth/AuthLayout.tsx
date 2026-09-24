import { AlertCircle, Eye, EyeOff, Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Input, type InputProps } from '@/components/ui/Input'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggleButton } from '@/components/layout/ThemeMenu'
import { cn } from '@/lib/cn'
import { useDocumentTitle } from '@/lib/hooks'

/** Centered card layout shared by the login and register pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <div className="relative flex min-h-dvh flex-col bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,var(--primary-subtle),transparent_70%)]"
      />
      <div className="relative flex justify-end p-4">
        <ThemeToggleButton />
      </div>
      <main className="relative flex flex-1 flex-col items-center px-4 pt-[6vh] pb-12">
        <Logo className="mb-8 scale-110" />
        <div className="w-full max-w-[400px] rounded-lg border border-border bg-surface p-8 shadow-raised">
          <h1 className="text-xl leading-7 font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-fg-muted">{footer}</div>}
      </main>
    </div>
  )
}

/** Inline alert box for form-level messages. */
export function FormAlert({ tone = 'danger', children }: { tone?: 'danger' | 'info'; children: ReactNode }) {
  const Icon = tone === 'danger' ? AlertCircle : Info
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2.5 text-sm',
        tone === 'danger' ? 'bg-danger-subtle text-danger' : 'bg-info-subtle text-info',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Password input with a show/hide toggle. */
export function PasswordInput(props: Omit<InputProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="flex size-6 items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-hover hover:text-fg [&_svg]:size-4"
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      }
    />
  )
}

/** Loose client-side email check (the server validates properly). */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
