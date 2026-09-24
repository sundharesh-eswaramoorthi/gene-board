import { createContext, use, useEffect, useId } from 'react'

/** Where an issue view is rendered: the `?issue=` modal or the `/browse/:issueKey` page. */
export type IssueViewVariant = 'modal' | 'page'

/** Shared state of one rendered issue view. */
export interface IssueViewContextValue {
  variant: IssueViewVariant
  /** Show another issue: swaps the modal content (`?issue=KEY`) or navigates to its page. */
  openIssue: (issueKey: string) => void
  /** The caller may edit (project member/admin) and the issue isn't being deleted. */
  canEdit: boolean
  /** Project admin (may delete anyone's comment). */
  isAdmin: boolean
  /** The issue is being deleted: its queries are paused and the view is inert. */
  deleting: boolean
  /** Editors with unsaved drafts (the modal asks before closing); absent on the full page. */
  unsavedEdits?: UnsavedEdits
}

/** Which editors of an issue view hold unsaved text (description, comments). */
export interface UnsavedEdits {
  /** Marks editor `id` as having (or no longer having) unsaved changes. */
  set(id: string, dirty: boolean): void
  /** Whether any editor has unsaved changes. */
  any(): boolean
}

/** A fresh, empty {@link UnsavedEdits} registry. */
export function createUnsavedEdits(): UnsavedEdits {
  const dirty = new Set<string>()
  return {
    set(id, isDirty) {
      if (isDirty) dirty.add(id)
      else dirty.delete(id)
    },
    any: () => dirty.size > 0,
  }
}

/**
 * Reports whether this editor holds an unsaved draft to the surrounding issue view. Drafts of
 * an issue being deleted don't count: they go away with it.
 */
export function useReportUnsaved(isDirty: boolean): void {
  const ctx = use(IssueViewContext)
  const edits = ctx?.unsavedEdits
  const dirty = isDirty && !ctx?.deleting
  const id = useId()
  useEffect(() => {
    if (!edits) return
    edits.set(id, dirty)
    return () => edits.set(id, false)
  }, [edits, id, dirty])
}

/** Provided by IssueViewLoader. */
export const IssueViewContext = createContext<IssueViewContextValue | null>(null)

/** The surrounding issue view's context (variant, permissions, navigation). */
export function useIssueView(): IssueViewContextValue {
  const ctx = use(IssueViewContext)
  if (!ctx) throw new Error('useIssueView must be used inside an issue view')
  return ctx
}

/**
 * Elements inside a `[data-local-escape]` container handle Escape themselves (cancel an edit,
 * close an inline form), so the issue modal must not close on that keypress.
 */
export const LOCAL_ESCAPE_SELECTOR = '[data-local-escape]'
