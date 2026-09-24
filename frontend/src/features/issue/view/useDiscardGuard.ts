import { useCallback, useEffect, useRef } from 'react'
import { useBlocker, type Location } from 'react-router'
import { useConfirm } from '@/components/ui'
import type { UnsavedEdits } from './IssueViewContext'

/**
 * Guards an issue view's unsaved drafts (description, comments) against in-app navigation: a
 * navigation for which `leaves(current, next)` holds — a link, Back / Forward, another issue —
 * asks "Discard unsaved changes?" first. Returns `confirmLeave` for the view's own ways out (the
 * modal's close button): it asks when needed and resolves true once leaving is settled, so the
 * navigation that follows isn't blocked a second time.
 *
 * A router runs only one blocker at a time (the newest): mount one guard per screen. The page's
 * guard steps aside while the issue modal, which has its own, is open.
 */
export function useDiscardGuard(
  unsavedEdits: UnsavedEdits,
  issueKey: string,
  leaves: (current: Location, next: Location) => boolean,
): () => Promise<boolean> {
  const confirm = useConfirm()
  // Set once leaving is settled (nothing unsaved, or the user chose to discard).
  const leaving = useRef(false)
  const prompting = useRef(false)

  const confirmDiscard = useCallback(
    () =>
      confirm({
        title: 'Discard unsaved changes?',
        description: 'Your edits to this issue’s description or comments haven’t been saved.',
        confirmLabel: 'Discard',
      }),
    [confirm],
  )

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !leaving.current && unsavedEdits.any() && leaves(currentLocation, nextLocation),
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

  // Another issue starts with nothing unsaved.
  useEffect(() => {
    leaving.current = false
  }, [issueKey])

  return useCallback(async () => {
    if (unsavedEdits.any() && !(await confirmDiscard())) return false
    leaving.current = true
    return true
  }, [unsavedEdits, confirmDiscard])
}

/**
 * Reloading or closing the tab with unsaved drafts gets the browser's own "Leave site?" prompt
 * (it can't be replaced by the app's dialog).
 */
export function useConfirmUnload(unsavedEdits: UnsavedEdits): void {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsavedEdits.any()) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsavedEdits])
}
