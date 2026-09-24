import { AlertDialog } from 'radix-ui'
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { Button } from './Button'
import { useReturnFocus } from './Dialog'
import { toast } from './toast'

/** Props of `ConfirmDialog`. */
export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Extra content between description and buttons (e.g. a type-to-confirm input). */
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` (default) for destructive actions, `primary` otherwise. */
  tone?: 'danger' | 'primary'
  /** Shows a spinner on the confirm button and blocks closing. */
  loading?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
}

/** Controlled confirmation dialog (Radix AlertDialog). Keeps itself open while `loading`. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) {
  const returnFocus = useReturnFocus()
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-overlay" />
        <AlertDialog.Content
          // Only records the opener: AlertDialog then focuses Cancel.
          onOpenAutoFocus={returnFocus.capture}
          onCloseAutoFocus={returnFocus.restore}
          className={cn(
            'fixed top-[max(1rem,14vh)] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[440px] -translate-x-1/2',
            'animate-scale-in rounded-lg border border-border bg-surface p-6 text-fg shadow-overlay focus:outline-none',
          )}
        >
          <AlertDialog.Title className="text-lg leading-7 font-semibold">{title}</AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="mt-2 text-sm text-fg-muted">{description}</AlertDialog.Description>
          ) : (
            <AlertDialog.Description className="sr-only">Please confirm this action.</AlertDialog.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="subtle" disabled={loading}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/** Options for {@link useConfirm}. */
export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  /**
   * Optional async action run when confirmed: the dialog shows a spinner until it settles,
   * closes on success, stays open and toasts the error on failure.
   */
  onConfirm?: () => Promise<unknown> | unknown
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Hosts the imperative confirm dialog used by {@link useConfirm}. Mounted in main.tsx. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOpen(false)
    setLoading(false)
  }, [])

  const confirm = useCallback<ConfirmFn>((opts) => {
    resolver.current?.(false)
    setOptions(opts)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!options?.onConfirm) return settle(true)
    setLoading(true)
    try {
      await options.onConfirm()
      settle(true)
    } catch (err) {
      setLoading(false)
      toast.error(errorMessage(err))
    }
  }, [options, settle])

  const value = useMemo(() => confirm, [confirm])
  return (
    <ConfirmContext value={value}>
      {children}
      {options && (
        <ConfirmDialog
          open={open}
          onOpenChange={(next) => !next && settle(false)}
          title={options.title}
          description={options.description}
          confirmLabel={options.confirmLabel}
          cancelLabel={options.cancelLabel}
          tone={options.tone}
          loading={loading}
          onConfirm={handleConfirm}
        />
      )}
    </ConfirmContext>
  )
}

/**
 * Imperative confirmation: `if (await confirm({ title: 'Delete comment?', confirmLabel: 'Delete' })) …`
 * or pass `onConfirm` to run the action with a spinner inside the dialog.
 */
export function useConfirm(): ConfirmFn {
  const ctx = use(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}
