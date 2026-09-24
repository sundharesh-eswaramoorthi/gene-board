import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker, type Location } from 'react-router'
import { ISSUE_MODAL_PARAM } from '@/app/ModalsProvider'
import { DialogPrimitive, useConfirm, useReturnFocus } from '@/components/ui'
import { isTypingTarget } from '@/lib/hooks'
import { IssueViewLoader } from './view/IssueViewLoader'
import { createUnsavedEdits, LOCAL_ESCAPE_SELECTOR } from './view/IssueViewContext'

/** Clicking a toast (outside the dialog) must not close it. */
function isToastEvent(event: Event): boolean {
  const target = event.target
  return target instanceof Element && target.closest('[data-sonner-toaster]') != null
}

/**
 * Escape closes the modal, except while typing in a field or inside an inline editor that
 * handles Escape itself (cancel the summary edit, close the link form, …).
 */
function handlesEscapeLocally(event: KeyboardEvent): boolean {
  const target = event.target
  if (isTypingTarget(target)) return true
  return target instanceof Element && target.closest(LOCAL_ESCAPE_SELECTOR) != null
}

/** The issue shown by the modal at a location (`?issue=`), upper-cased. */
function modalIssueOf(location: Location): string {
  return new URLSearchParams(location.search).get(ISSUE_MODAL_PARAM)?.toUpperCase() ?? ''
}

/**
 * Issue detail modal (fixed contract, rendered by ModalsProvider for `?issue=KEY`): a large
 * dialog around the shared issue view. Escape, the overlay and the close button call `onClose`.
 * Opening another issue from inside (child, parent, link) swaps the content in place.
 *
 * With an unsaved description or comment draft, every way of leaving the issue — Escape, the
 * overlay, the close button, Back / Forward, opening another issue — asks to discard it first.
 */
export function IssueDetailModal({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()
  const [unsavedEdits] = useState(createUnsavedEdits)
  // Set once leaving is settled (nothing unsaved, or the user chose to discard), so the
  // resulting navigation isn't blocked a second time.
  const leaving = useRef(false)
  const prompting = useRef(false)
  // Closing returns focus to what opened the modal. Opened from the URL, or when its card was
  // re-created (a status change moves it to another column): the issue's card or backlog row.
  const openedKey = useRef(issueKey)
  const returnFocus = useReturnFocus(() =>
    document.querySelector<HTMLElement>(
      `[data-testid="issue-card-${openedKey.current}"], [data-testid="backlog-row-${openedKey.current}"]`,
    ),
  )

  const confirmDiscard = useCallback(
    () =>
      confirm({
        title: 'Discard unsaved changes?',
        description: 'Your edits to this issue’s description or comments haven’t been saved.',
        confirmLabel: 'Discard',
      }),
    [confirm],
  )

  const requestClose = useCallback(async () => {
    if (unsavedEdits.any() && !(await confirmDiscard())) return
    leaving.current = true
    onClose()
  }, [unsavedEdits, confirmDiscard, onClose])

  // History navigation (Back, Forward) and in-modal links close or swap the issue too.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !leaving.current && unsavedEdits.any() && modalIssueOf(currentLocation) !== modalIssueOf(nextLocation),
  )
  useEffect(() => {
    if (blocker.state !== 'blocked' || prompting.current) return
    prompting.current = true
    void confirmDiscard().then((discard) => {
      prompting.current = false
      if (discard) {
        leaving.current = true
        blocker.proceed()
      } else {
        blocker.reset()
      }
    })
  }, [blocker, confirmDiscard])

  // Another issue in the modal starts with nothing unsaved.
  useEffect(() => {
    leaving.current = false
  }, [issueKey])

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && void requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            returnFocus.capture()
            // Focus the dialog itself rather than its first control (the breadcrumb link).
            event.preventDefault()
            contentRef.current?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={returnFocus.restore}
          onEscapeKeyDown={(event) => {
            if (handlesEscapeLocally(event)) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (isToastEvent(event)) event.preventDefault()
          }}
          className="fixed top-[max(1rem,6vh)] left-1/2 z-40 flex h-[calc(100dvh-max(2rem,12vh))] w-[calc(100vw-2rem)] max-w-[1080px] -translate-x-1/2 animate-scale-in flex-col overflow-hidden rounded-lg border border-border bg-surface text-fg shadow-overlay focus:outline-none"
        >
          <IssueViewLoader
            key={issueKey}
            issueKey={issueKey}
            variant="modal"
            onClose={() => void requestClose()}
            unsavedEdits={unsavedEdits}
            renderTitle={(title) => <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
