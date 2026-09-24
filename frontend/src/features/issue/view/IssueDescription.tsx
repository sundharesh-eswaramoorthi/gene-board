import { Pencil } from 'lucide-react'
import { useId, useState, type MouseEvent } from 'react'
import type { IssueDetail } from '@/api/types'
import { Button, ChangedElsewhereNotice, useConfirm, useEditDraft } from '@/components/ui'
import { Markdown } from '@/components/ui/Markdown'
import { MarkdownEditor } from '../shared/MarkdownEditor'
import type { SaveIssue } from '../shared/useIssueSave'
import { MAX_DESCRIPTION_LENGTH } from '../shared/limits'
import { useIssueView, useReportUnsaved } from './IssueViewContext'

/**
 * Markdown description: rendered view (click it, or "Edit", to change it) and an editor with
 * Write / Preview tabs. ⌘/Ctrl+Enter saves, Escape cancels (asking first when there are edits).
 * Edits are measured against the text editing started from: an untouched editor follows live
 * changes and saves nothing, and a real edit says so when someone else changes the description.
 */
export function IssueDescription({ issue, save }: { issue: IssueDetail; save: SaveIssue }) {
  const { canEdit } = useIssueView()
  const confirm = useConfirm()
  const headingId = useId()
  const [saving, setSaving] = useState(false)

  const description = issue.description
  const hasDescription = description.trim() !== ''
  const { editing, draft, setDraft, start, stop, dirty, changedElsewhere } = useEditDraft(description)
  useReportUnsaved(dirty)

  const cancelWithConfirm = async () => {
    if (dirty) {
      const discard = await confirm({
        title: 'Discard changes?',
        description: 'Your changes to the description haven’t been saved.',
        confirmLabel: 'Discard',
      })
      if (!discard) return
    }
    stop()
  }

  const submit = async () => {
    if (saving) return
    if (!dirty) {
      stop()
      return
    }
    setSaving(true)
    const ok = await save({ description: draft.trim() })
    setSaving(false)
    if (ok) stop()
  }

  // Clicking the rendered text edits it, except on links/controls or after selecting text.
  const onViewClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!canEdit) return
    if ((e.target as HTMLElement).closest('a, button, input, summary')) return
    if (window.getSelection()?.toString()) return
    start()
  }

  let body
  if (editing) {
    body = (
      <div data-local-escape>
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          autoFocus
          minRows={6}
          maxLength={MAX_DESCRIPTION_LENGTH}
          disabled={saving}
          placeholder="Add a description… Markdown is supported: **bold**, _italic_, lists, `code`, tables."
          aria-label="Description"
          onSubmit={() => void submit()}
          submitHint="to save"
          onEscape={() => void cancelWithConfirm()}
          footer={
            <>
              {changedElsewhere && (
                <ChangedElsewhereNotice className="mt-0">
                  Someone else updated the description while you were editing. Saving replaces their version; Cancel
                  keeps it.
                </ChangedElsewhereNotice>
              )}
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" loading={saving} onClick={() => void submit()}>
                  Save
                </Button>
                <Button variant="subtle" size="sm" disabled={saving} onClick={stop}>
                  Cancel
                </Button>
              </div>
            </>
          }
        />
      </div>
    )
  } else if (hasDescription) {
    body = canEdit ? (
      // Mouse shortcut only; keyboard users use the "Edit" button in the heading.
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div
        onClick={onViewClick}
        title="Click to edit"
        className="-mx-2 cursor-text rounded-sm px-2 py-1.5 transition-colors hover:bg-surface-hover"
      >
        <Markdown>{description}</Markdown>
      </div>
    ) : (
      <Markdown>{description}</Markdown>
    )
  } else if (canEdit) {
    body = (
      <button
        type="button"
        onClick={start}
        className="-mx-2 w-[calc(100%+1rem)] rounded-sm px-2 py-2 text-left text-sm text-fg-subtle transition-colors hover:bg-surface-hover"
      >
        Add a description…
      </button>
    )
  } else {
    body = <p className="text-sm text-fg-subtle">No description</p>
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-fg">
          Description
        </h3>
        {canEdit && !editing && hasDescription && (
          <Button variant="subtle" size="sm" icon={<Pencil />} onClick={start} aria-label="Edit description">
            Edit
          </Button>
        )}
      </div>
      {body}
    </section>
  )
}
