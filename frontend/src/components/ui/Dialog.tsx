import { X } from 'lucide-react'
import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui'
import { useRef, type FormEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'

/**
 * Marks an element (or container) that handles Escape itself, e.g. an inline editor that
 * cancels its edit: Escape pressed inside it does not close the surrounding dialog.
 */
export const LOCAL_ESCAPE_ATTRIBUTE = 'data-local-escape'
const LOCAL_ESCAPE_SELECTOR = `[${LOCAL_ESCAPE_ATTRIBUTE}]`

/** True when Escape was pressed inside an element marked with {@link LOCAL_ESCAPE_ATTRIBUTE}. */
export function isLocalEscape(event: KeyboardEvent): boolean {
  const target = event.target
  return target instanceof Element && target.closest(LOCAL_ESCAPE_SELECTOR) != null
}

/**
 * True for pointer/focus events on a toast. Toasts live outside every dialog, so without this
 * a click on a toast action counts as an outside click and closes the dialog.
 */
export function isToastEvent(event: Event): boolean {
  const target = event.target
  return target instanceof Element && target.closest('[data-sonner-toaster]') != null
}

/**
 * Where focus goes back to for `element` (what had focus when a dialog opened). A menu closes as
 * its item opens a dialog, so for a menu item that is the button that opened the menu.
 */
function focusOrigin(element: Element | null): HTMLElement | null {
  let origin = element
  let menu = origin?.closest('[role=menu]')
  while (menu) {
    const trigger = document.getElementById(menu.getAttribute('aria-labelledby') ?? '')
    if (!trigger || menu.contains(trigger)) break
    origin = trigger
    menu = trigger.closest('[role=menu]')
  }
  return origin instanceof HTMLElement ? origin : null
}

/**
 * Gives focus back to what opened a dialog when it closes. Radix only refocuses a `Trigger`, and
 * our dialogs are opened from state, so without this focus falls to `<body>`. Call `capture` in
 * `onOpenAutoFocus` (before focus moves into the dialog) and pass `restore` as `onCloseAutoFocus`.
 *
 * When the opener is gone (e.g. deleted by the dialog), focus goes to `fallback()`, else to the
 * opener's closest remaining container that takes focus (the dialog underneath, `<main>`).
 */
export function useReturnFocus(fallback?: () => HTMLElement | null) {
  // The opener, then its ancestors up to <body>.
  const origin = useRef<HTMLElement[]>([])
  const capture = () => {
    const chain: HTMLElement[] = []
    for (let el = focusOrigin(document.activeElement); el && el !== document.body; el = el.parentElement) chain.push(el)
    origin.current = chain
  }
  const restore = (event: Event) => {
    event.preventDefault()
    const main = document.querySelector<HTMLElement>('main')
    // Focus has already moved on (another dialog opened, the next page focused a field). Not when
    // it's on `<main>`, the last resort: a dialog that closed along with this one (a confirm on
    // top, whose opener went with this dialog) may have put it there.
    const active = document.activeElement
    if (active && active !== document.body && active !== main && active.isConnected) return
    const [opener, ...ancestors] = origin.current
    for (const el of [opener, fallback?.(), ...ancestors, main]) {
      if (!el?.isConnected) continue
      el.focus()
      if (document.activeElement === el) return
    }
  }
  return { capture, restore }
}

/** Dialog width preset. */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<DialogSize, string> = {
  sm: 'max-w-[400px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[1080px]',
}

/** Props of `Dialog`. */
export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog title (always announced; visually hidden when `hideHeader`). */
  title: ReactNode
  /** Optional sub-title under the title. */
  description?: ReactNode
  /** Body content (scrolls when tall). */
  children: ReactNode
  /** Footer, typically buttons; right-aligned. */
  footer?: ReactNode
  /** Content left of the footer buttons (e.g. a "Create another" checkbox). */
  footerStart?: ReactNode
  /** Extra header buttons shown before the close button. */
  headerActions?: ReactNode
  size?: DialogSize
  /** Omit the built-in header (title stays for screen readers) — for fully custom layouts. */
  hideHeader?: boolean
  /** When set, the dialog content is wrapped in a `<form>`; footer submit buttons work. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  /** Prevent closing by outside click / Escape (e.g. while saving). Default false. */
  preventClose?: boolean
  /**
   * Called on Escape before the dialog closes; `event.preventDefault()` keeps it open. Escape
   * inside a `[data-local-escape]` element never closes the dialog (see {@link isLocalEscape}).
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  /**
   * Override initial focus. By default focus goes to the enabled element marked `data-autofocus`,
   * else the first enabled input/textarea/select in the body, else the first focusable element.
   */
  onOpenAutoFocus?: (event: Event) => void
  className?: string
  bodyClassName?: string
  'data-testid'?: string
}

/**
 * Modal dialog (Radix) with header, scrollable body and footer. Sizes: sm 400, md 560,
 * lg 720, xl 1080px. Pass `onSubmit` to make it a form dialog. Closing it gives focus back to
 * what opened it ({@link useReturnFocus}).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  footerStart,
  headerActions,
  size = 'md',
  hideHeader = false,
  onSubmit,
  preventClose = false,
  onEscapeKeyDown,
  onOpenAutoFocus,
  className,
  bodyClassName,
  'data-testid': testId,
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const returnFocus = useReturnFocus()
  const handleOpenAutoFocus = (event: Event) => {
    returnFocus.capture()
    if (onOpenAutoFocus) return onOpenAutoFocus(event)
    const content = contentRef.current
    const target =
      content?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
      content?.querySelector<HTMLElement>(
        '[data-dialog-body] :is(input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled))',
      )
    target?.focus()
    // Otherwise Radix focuses the first focusable element (or the dialog): focus must not stay
    // on the page behind.
    if (target && document.activeElement === target) event.preventDefault()
  }

  const inner = (
    <>
      {hideHeader ? (
        <VisuallyHidden.Root>
          <RadixDialog.Title>{title}</RadixDialog.Title>
          {description && <RadixDialog.Description>{description}</RadixDialog.Description>}
        </VisuallyHidden.Root>
      ) : (
        <div className="flex items-start gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <RadixDialog.Title className="text-lg leading-7 font-semibold text-fg">{title}</RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="mt-0.5 text-sm text-fg-muted">{description}</RadixDialog.Description>
            )}
          </div>
          <div className="-mt-0.5 -mr-2 flex items-center gap-1">
            {headerActions}
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={<X />} tooltip={false} />
            </RadixDialog.Close>
          </div>
        </div>
      )}
      <div data-dialog-body className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-5', hideHeader && 'pt-5', bodyClassName)}>
        {children}
      </div>
      {(footer || footerStart) && (
        <div className="flex items-center gap-3 border-t border-border px-6 py-3">
          <div className="flex min-w-0 flex-1 items-center">{footerStart}</div>
          <div className="flex items-center gap-2">{footer}</div>
        </div>
      )}
    </>
  )

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <RadixDialog.Content
          data-testid={testId}
          {...(!description && { 'aria-describedby': undefined })}
          ref={contentRef}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={returnFocus.restore}
          onEscapeKeyDown={(e) => {
            if (preventClose || isLocalEscape(e)) {
              e.preventDefault()
              return
            }
            onEscapeKeyDown?.(e)
          }}
          onPointerDownOutside={(e) => (preventClose || isToastEvent(e)) && e.preventDefault()}
          onInteractOutside={(e) => (preventClose || isToastEvent(e)) && e.preventDefault()}
          className={cn(
            'fixed top-[max(1rem,6vh)] left-1/2 z-40 flex max-h-[calc(100dvh-max(2rem,12vh))] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col',
            'animate-scale-in rounded-lg border border-border bg-surface text-fg shadow-overlay focus:outline-none',
            SIZES[size],
            className,
          )}
        >
          {onSubmit ? (
            <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
              {inner}
            </form>
          ) : (
            inner
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Radix Dialog parts for rare fully-custom dialogs (prefer {@link Dialog}). */
export const DialogPrimitive = RadixDialog
