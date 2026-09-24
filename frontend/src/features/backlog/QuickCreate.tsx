import { Maximize2, Plus, X } from 'lucide-react'
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useCreateIssue } from '@/api/issues'
import type { ID, IssueType } from '@/api/types'
import { useCreateIssueModal } from '@/app/ModalsProvider'
import { EpicChip, TypeSelect } from '@/components/issue'
import { IconButton, Kbd, Spinner, toastError } from '@/components/ui'
import { useLocalStorageState } from '@/lib/hooks'
import { STANDARD_ISSUE_TYPES } from '@/lib/issueMeta'
import type { QuickCreateParent } from './BacklogContext'
import type { ContainerId } from './model'

const TYPE_STORAGE_KEY = 'gb-backlog-quick-create-type'
const SUMMARY_MAX = 255

/** Props of `QuickCreate`. */
export interface QuickCreateProps {
  projectKey: string
  containerId: ContainerId
  /** Sprint of the section (`null` = backlog, `undefined` = Kanban list: leave unset). */
  sprintId: ID | null | undefined
  /** Epic to create the issue in (active epic filter). */
  parent: QuickCreateParent | null
}

/**
 * Inline "+ Create issue" for a backlog section: type + summary, Enter creates (and stays open
 * for the next one), Escape cancels. The expand button hands the draft to the full create modal.
 */
export function QuickCreate({ projectKey, containerId, sprintId, parent }: QuickCreateProps) {
  const [open, setOpen] = useState(false)
  const [storedType, setType] = useLocalStorageState<IssueType>(TYPE_STORAGE_KEY, 'story')
  const [summary, setSummary] = useState('')
  const [inFlight, setInFlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useCreateIssue()
  const { openCreateIssue } = useCreateIssueModal()
  const type: IssueType = STANDARD_ISSUE_TYPES.includes(storedType) ? storedType : 'story'

  const close = () => {
    setOpen(false)
    setSummary('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = summary.trim()
    if (!text) return
    // Clear right away so the next issue can be typed while this one saves.
    setSummary('')
    setInFlight((n) => n + 1)
    try {
      await create.mutateAsync({
        projectKey,
        type,
        summary: text,
        ...(sprintId != null && { sprintId }),
        ...(parent && { parentId: parent.id }),
      })
    } catch (err) {
      toastError(err, 'Couldn’t create the issue')
      setSummary((current) => (current === '' ? text : current))
    } finally {
      setInFlight((n) => n - 1)
      inputRef.current?.focus()
    }
  }

  const openFullForm = () => {
    openCreateIssue({
      projectKey,
      type,
      summary: summary.trim() || undefined,
      ...(sprintId !== undefined && { sprintId }),
      ...(parent && { parentId: parent.id, parentKey: parent.key, parentType: 'epic' }),
    })
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`backlog-quick-create-${containerId}`}
        className="mt-1 flex h-8 w-full items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <Plus className="size-4" aria-hidden />
        Create issue
      </button>
    )
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Create issue"
      className="mt-1 flex h-10 animate-fade-in items-center gap-1.5 rounded-sm border border-primary bg-surface pr-1.5 pl-1 ring-2 ring-ring/25"
    >
      <TypeSelect
        variant="compact"
        value={type}
        onChange={setType}
        types={STANDARD_ISSUE_TYPES}
      />
      <input
        ref={inputRef}
        autoFocus
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={SUMMARY_MAX}
        placeholder="What needs to be done?"
        aria-label="Summary"
        data-testid={`backlog-quick-create-input-${containerId}`}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
      />
      {parent && (
        <span className="hidden items-center gap-1 text-2xs text-fg-subtle @lg:flex">
          in <EpicChip epic={parent} />
        </span>
      )}
      {inFlight > 0 && <Spinner size="xs" label="Creating issue" className="text-fg-subtle" />}
      <span className="hidden items-center gap-1 text-2xs text-fg-subtle @xl:flex" aria-hidden>
        <Kbd>Enter</Kbd> to create
      </span>
      <IconButton size="xs" label="Open in the full create dialog" icon={<Maximize2 />} onClick={openFullForm} />
      <IconButton size="xs" label="Cancel" icon={<X />} onClick={close} />
    </form>
  )
}
