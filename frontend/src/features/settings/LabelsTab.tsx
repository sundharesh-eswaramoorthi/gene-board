import { ExternalLink, Plus, Tag, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useCreateLabel, useDeleteLabel, useLabels, useUpdateLabel } from '@/api/labels'
import type { Label, Project } from '@/api/types'
import { LabelChip } from '@/components/issue/LabelChip'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { EditableText } from '@/components/ui/EditableText'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { Field } from '@/components/ui/Field'
import { Input, SearchInput } from '@/components/ui/Input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { toast, toastError } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/Tooltip'
import { issueSearchPath } from '@/features/search/issueFilters'
import { fieldErrors, isApiStatus } from '@/lib/errors'
import { pluralize } from '@/lib/format'
import { ColorSwatches } from './ColorSwatches'
import { colorName, suggestedLabelColor } from './labelPalette'
import { SettingsSection } from './SettingsSection'

/** Max label name length (SPEC §5). */
const LABEL_NAME_MAX = 40
/** Show a filter box above the list from this many labels. */
const SEARCH_THRESHOLD = 8

/** Props of {@link LabelsTab}. */
export interface LabelsTabProps {
  project: Project
  isAdmin: boolean
  /** Members may create labels; only admins rename, recolour and delete them. */
  canEdit: boolean
}

/** Project labels: create (members), rename, recolour and delete (admins). */
export function LabelsTab({ project, isAdmin, canEdit }: LabelsTabProps) {
  const labels = useLabels(project.key)
  const [query, setQuery] = useState('')
  const list = useMemo(() => labels.data ?? [], [labels.data])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? list.filter((l) => l.name.toLowerCase().includes(q)) : list
  }, [list, query])

  return (
    <div className="flex flex-col gap-6">
      {canEdit && <CreateLabelForm projectKey={project.key} existing={list} />}

      <SettingsSection
        title="Labels"
        description={
          labels.data
            ? `${pluralize(list.length, 'label')} to categorise issues across the project.`
            : 'Categorise issues across the project.'
        }
        actions={
          list.length >= SEARCH_THRESHOLD && (
            <SearchInput value={query} onChange={setQuery} placeholder="Filter labels" size="sm" className="w-48" />
          )
        }
        bodyClassName="px-0 pb-0"
      >
        {labels.isPending ? (
          <SkeletonRows rows={4} className="border-t border-border" />
        ) : labels.isLoadingError ? (
          <ErrorState size="sm" error={labels.error} title="Couldn’t load labels" onRetry={() => void labels.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Tag />}
            title="No labels yet"
            description={canEdit ? 'Create labels above, or add them straight from an issue.' : 'Labels created by the team will appear here.'}
            className="border-t border-border"
          />
        ) : visible.length === 0 ? (
          <p className="border-t border-border px-5 py-6 text-center text-sm text-fg-muted">No labels match “{query.trim()}”.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border" data-testid="labels-list">
            {visible.map((label) => (
              <LabelRow key={label.id} projectKey={project.key} label={label} isAdmin={isAdmin} />
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  )
}

function LabelRow({ projectKey, label, isAdmin }: { projectKey: string; label: Label; isAdmin: boolean }) {
  const update = useUpdateLabel(projectKey)
  const remove = useDeleteLabel(projectKey)
  const confirm = useConfirm()
  const [colorOpen, setColorOpen] = useState(false)

  const rename = async (name: string) => {
    try {
      await update.mutateAsync({ id: label.id, name })
    } catch (err) {
      if (isApiStatus(err, 409)) throw new Error(`A label named “${name}” already exists`)
      throw err
    }
  }

  const recolor = (color: string) => {
    setColorOpen(false)
    if (color.toUpperCase() === label.color.toUpperCase()) return
    update.mutate({ id: label.id, color }, { onError: (err) => toastError(err, 'Couldn’t change the colour') })
  }

  const swatch = <span className="block size-5 rounded-full" style={{ backgroundColor: label.color }} />

  return (
    <li className="flex items-center gap-3 px-5 py-2" data-testid={`label-row-${label.id}`}>
      {isAdmin ? (
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <Tooltip content="Change colour">
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Colour of ${label.name}: ${colorName(label.color)}. Change colour`}
                className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-surface-hover"
              >
                {swatch}
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent className="w-auto">
            <p className="mb-2 text-xs font-semibold text-fg-muted">Colour of “{label.name}”</p>
            <ColorSwatches mode="buttons" value={label.color} onChange={recolor} aria-label={`Colour of ${label.name}`} className="max-w-56" />
          </PopoverContent>
        </Popover>
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center" title={colorName(label.color)}>
          {swatch}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <EditableText
          value={label.name}
          label="Label name"
          disabled={!isAdmin}
          maxLength={LABEL_NAME_MAX}
          onSave={rename}
          className="text-sm leading-7 font-medium text-fg"
        />
      </div>
      <LabelChip label={label} className="hidden sm:inline-flex" />
      <Link
        to={issueSearchPath({ labelIds: [label.id] }, projectKey)}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        Issues <ExternalLink className="size-3" aria-hidden />
        <span className="sr-only">with label {label.name}</span>
      </Link>
      {isAdmin && (
        <IconButton
          size="sm"
          variant="danger"
          label={`Delete label ${label.name}`}
          tooltip="Delete label"
          icon={<Trash2 />}
          onClick={() =>
            void confirm({
              title: `Delete label “${label.name}”?`,
              description: 'It will be removed from every issue that has it. This can’t be undone.',
              confirmLabel: 'Delete label',
              onConfirm: async () => {
                await remove.mutateAsync(label.id)
                toast.success(`Deleted label “${label.name}”`)
              },
            })
          }
        />
      )}
    </li>
  )
}

function CreateLabelForm({ projectKey, existing }: { projectKey: string; existing: readonly Label[] }) {
  const create = useCreateLabel(projectKey)
  const [name, setName] = useState('')
  const [pickedColor, setPickedColor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()
  const color = pickedColor ?? suggestedLabelColor(trimmed)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed) return setError('Give the label a name')
    if (existing.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError(`A label named “${trimmed}” already exists`)
    }
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: (label) => {
          toast.success(`Created label “${label.name}”`)
          setName('')
          setPickedColor(null)
          setError(null)
        },
        onError: (err) => {
          if (isApiStatus(err, 409)) setError(`A label named “${trimmed}” already exists`)
          else if (fieldErrors(err).name) setError(`Name ${fieldErrors(err).name}`)
          else toastError(err, 'Couldn’t create the label')
        },
      },
    )
  }

  return (
    <SettingsSection title="Create a label" description="Labels are shared by everyone in the project.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="create-label-form">
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Name" error={error ?? undefined}>
            <Input
              value={name}
              maxLength={LABEL_NAME_MAX}
              placeholder="e.g. frontend"
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              data-testid="create-label-name"
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-fg-muted" aria-hidden>
              Colour
            </span>
            <ColorSwatches value={color} onChange={setPickedColor} aria-label="Label colour" className="min-h-8" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            Preview <LabelChip label={{ name: trimmed || 'label', color }} size="md" />
          </p>
          <Button type="submit" variant="primary" icon={<Plus />} loading={create.isPending}>
            Create label
          </Button>
        </div>
      </form>
    </SettingsSection>
  )
}
