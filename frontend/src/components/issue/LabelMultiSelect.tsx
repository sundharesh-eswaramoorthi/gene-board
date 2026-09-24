import { Plus, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ID, Label } from '@/api/types'
import { useCreateLabel, useLabels } from '@/api/labels'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { toastError } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { hashString, LABEL_COLORS } from '@/lib/colors'
import { LabelChip } from './LabelChip'
import { PickerPlaceholder, PickerTrigger, type PickerCommonProps } from './PickerTrigger'

const CREATE = -1

/** Props of `LabelMultiSelect`. */
export interface LabelMultiSelectProps extends PickerCommonProps {
  projectKey: string
  /** Selected label ids, or the Label objects (e.g. `issue.labels`, displayed before the list loads). */
  value: readonly ID[] | readonly Label[]
  onChange: (labelIds: ID[], labels: Label[]) => void
  /** Offer "Create label" for unknown names (members can create labels). Default true. */
  allowCreate?: boolean
  /**
   * `immediate` (default, for forms): every toggle calls onChange.
   * `onClose` (for inline editing): changes are collected and onChange fires once when the
   * popover closes — one PATCH instead of one per click.
   */
  commitMode?: 'immediate' | 'onClose'
}

function sameSet(a: readonly ID[], b: readonly ID[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

/** Multi-select for project labels with search and inline creation of new labels. */
export function LabelMultiSelect({
  projectKey,
  value,
  onChange,
  allowCreate = true,
  commitMode = 'immediate',
  variant = 'field',
  disabled,
  placeholder,
  className,
  trigger,
  align,
  open: openProp,
  onOpenChange,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: LabelMultiSelectProps) {
  const labelsQuery = useLabels(projectKey)
  const createLabel = useCreateLabel(projectKey)
  const [created, setCreated] = useState<Label[]>([])
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const [draft, setDraft] = useState<ID[] | null>(null)
  const [query, setQuery] = useState('')

  const valueIds = useMemo(() => value.map((v) => (typeof v === 'number' ? v : v.id)), [value])
  const known = useMemo(() => {
    const map = new Map<ID, Label>()
    for (const v of value) if (typeof v !== 'number') map.set(v.id, v)
    for (const l of labelsQuery.data ?? []) map.set(l.id, l)
    for (const l of created) map.set(l.id, l)
    return map
  }, [value, labelsQuery.data, created])

  const selectedIds = commitMode === 'onClose' && draft ? draft : valueIds

  const emit = (ids: ID[], extra: readonly Label[] = []) => {
    const map = new Map(known)
    for (const l of extra) map.set(l.id, l)
    onChange(ids, ids.map((i) => map.get(i)).filter((l): l is Label => !!l))
  }

  const toggleIn = (ids: readonly ID[], labelId: ID): ID[] =>
    ids.includes(labelId) ? ids.filter((x) => x !== labelId) : [...ids, labelId]

  const toggle = (labelId: ID, extra?: readonly Label[]) => {
    if (commitMode === 'onClose') setDraft((d) => toggleIn(d ?? valueIds, labelId))
    else emit(toggleIn(valueIds, labelId), extra)
  }

  const setOpen = (next: boolean) => {
    if (next) {
      setDraft(valueIds)
      setQuery('')
    } else {
      if (commitMode === 'onClose' && draft && !sameSet(draft, valueIds)) emit(draft)
      setDraft(null)
    }
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const create = async (name: string) => {
    try {
      const color = LABEL_COLORS[hashString(name.toLowerCase()) % LABEL_COLORS.length]
      const label = await createLabel.mutateAsync({ name, color })
      setCreated((c) => [...c, label])
      setQuery('')
      toggle(label.id, [label])
    } catch (err) {
      toastError(err, 'Couldn’t create label')
    }
  }

  const q = query.trim()
  const options = useMemo(() => {
    const all = labelsQuery.data ?? []
    const needle = q.toLowerCase()
    const list: ComboboxOption<ID>[] = all
      .filter((l) => !needle || l.name.toLowerCase().includes(needle))
      .map((l) => ({
        value: l.id,
        label: l.name,
        render: (
          <span className="flex min-w-0 flex-1">
            <LabelChip label={l} size="md" />
          </span>
        ),
      }))
    if (allowCreate && q && q.length <= 40 && !all.some((l) => l.name.toLowerCase() === needle)) {
      list.push({
        value: CREATE,
        label: `Create “${q}”`,
        icon: <Plus className="size-4 text-fg-muted" />,
        disabled: createLabel.isPending,
        action: true,
      })
    }
    return list
  }, [labelsQuery.data, q, allowCreate, createLabel.isPending])

  const selectedLabels = selectedIds.map((i) => known.get(i)).filter((l): l is Label => !!l)
  const emptyText = placeholder ?? (variant === 'inline' ? 'None' : 'Select labels')

  const triggerEl = trigger ?? (
    <PickerTrigger
      variant={variant}
      disabled={disabled}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? `Labels: ${selectedLabels.map((l) => l.name).join(', ') || 'none'}`}
      className={cn(variant !== 'compact' && 'h-auto min-h-8 py-1', className)}
    >
      {variant === 'compact' ? (
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <Tag className="size-3.5" aria-hidden />
          {selectedLabels.length > 0 && selectedLabels.length}
        </span>
      ) : selectedLabels.length > 0 ? (
        <span className="flex min-w-0 flex-wrap gap-1">
          {selectedLabels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </span>
      ) : (
        <PickerPlaceholder>{emptyText}</PickerPlaceholder>
      )}
    </PickerTrigger>
  )
  if (disabled) return triggerEl

  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={selectedIds}
      multiple
      searchable
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={allowCreate ? 'Search or create labels…' : 'Search labels…'}
      loading={labelsQuery.isLoading || createLabel.isPending}
      emptyText={allowCreate ? 'Type to create a label' : 'No labels'}
      width={280}
      align={align}
      open={open}
      onOpenChange={setOpen}
      aria-label="Labels"
      onSelect={(o) => {
        if (o.value === CREATE) void create(q)
        else toggle(o.value)
      }}
    />
  )
}
