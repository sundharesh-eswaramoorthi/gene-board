import { Lock } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { Role } from '@/api/types'
import { cn } from '@/lib/cn'
import { ROLE_META } from '@/lib/issueMeta'

/** Props of {@link SettingsSection}. */
export interface SettingsSectionProps {
  title: ReactNode
  description?: ReactNode
  /** Controls aligned right of the title. */
  actions?: ReactNode
  /** Footer bar (e.g. Save / Discard). */
  footer?: ReactNode
  /** `danger` outlines the card in red (danger zone). */
  tone?: 'default' | 'danger'
  children?: ReactNode
  className?: string
  bodyClassName?: string
}

/** A titled settings card: header (title, description, actions), body and optional footer. */
export function SettingsSection({
  title,
  description,
  actions,
  footer,
  tone = 'default',
  children,
  className,
  bodyClassName,
}: SettingsSectionProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'rounded-lg border bg-surface',
        tone === 'danger' ? 'border-danger/40' : 'border-border',
        className,
      )}
    >
      <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-4', children || footer ? 'pb-3' : 'pb-4')}>
        <div className="min-w-0">
          <h2 id={headingId} className={cn('text-base font-semibold', tone === 'danger' ? 'text-danger' : 'text-fg')}>
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className={cn('px-5 pb-5', bodyClassName)}>{children}</div>}
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-border bg-surface-sunken/60 px-5 py-3">
          {footer}
        </div>
      )}
    </section>
  )
}

/** Banner for non-admins explaining why the settings are read-only. */
export function ReadOnlyNotice({ role }: { role: Role | null }) {
  const roleLabel = role ? ROLE_META[role].label.toLowerCase() : 'member'
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-info/30 bg-info-subtle px-4 py-3 text-sm text-fg"
      data-testid="settings-read-only"
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p>
        <span className="font-semibold">You have {roleLabel} access.</span>{' '}
        <span className="text-fg-muted">
          Only project admins can change the details, members and columns
          {role === 'member' ? '. You can still create labels.' : '.'} Ask an admin if something needs to change.
        </span>
      </p>
    </div>
  )
}
