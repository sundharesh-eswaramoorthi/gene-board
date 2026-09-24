import { keepPreviousData } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { ID, Issue, IssueRef, IssueType } from '@/api/types'
import { useIssues } from '@/api/issues'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { useDebouncedValue } from '@/lib/hooks'
import { IssueTypeIcon } from './IssueTypeIcon'
import { PickerPlaceholder, PickerTrigger, type PickerCommonProps } from './PickerTrigger'
import { StatusLozenge } from './StatusLozenge'

const NONE = -1

/** Minimal issue shape a picker can display. */
export type IssuePickerValue = Pick<IssueRef, 'id' | 'key' | 'summary' | 'type'>

/** Props of `IssuePicker`. */
export interface IssuePickerProps extends PickerCommonProps {
  value: IssuePickerValue | null
  /** Receives the chosen issue (full `Issue` from the search), or null for "None". */
  onChange: (issue: Issue | null) => void
  /** Restrict to one project (omit to search all the caller's projects). */
  projectKey?: string
  /** Restrict issue types. */
  types?: readonly IssueType[]
  /** Hide these issue ids (e.g. the current issue). */
  excludeIds?: readonly ID[]
  /** Only offer issues this accepts (e.g. issues of projects the caller may edit). */
  filter?: (issue: Issue) => boolean
  /** Offer a "None" option that clears the value. Default false. */
  allowNone?: boolean
  noneLabel?: string
  searchPlaceholder?: string
}

/** Server-side issue search picker (key or text), e.g. for adding links. */
export function IssuePicker({
  value,
  onChange,
  projectKey,
  types,
  excludeIds,
  filter,
  allowNone = false,
  noneLabel = 'None',
  searchPlaceholder = 'Search by key or summary…',
  variant = 'field',
  disabled,
  placeholder = 'Select issue',
  className,
  trigger,
  align,
  open: openProp,
  onOpenChange,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: IssuePickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query.trim(), 200)

  const results = useIssues(
    { project: projectKey, type: types, q: debounced, sort: 'updated', limit: 20 },
    { enabled: open && !disabled, placeholderData: keepPreviousData },
  )

  const options = useMemo(() => {
    const list: ComboboxOption<ID>[] = []
    if (allowNone) list.push({ value: NONE, label: noneLabel })
    for (const issue of results.data?.items ?? []) {
      if (excludeIds?.includes(issue.id) || (filter && !filter(issue))) continue
      list.push({
        value: issue.id,
        label: `${issue.key} ${issue.summary}`,
        render: (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <IssueTypeIcon type={issue.type} title={false} />
            <span className="shrink-0 text-xs font-medium text-fg-muted">{issue.key}</span>
            <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
            <StatusLozenge status={issue.status} className="max-w-24" />
          </span>
        ),
      })
    }
    return list
  }, [results.data, excludeIds, filter, allowNone, noneLabel])

  const triggerEl = trigger ?? (
    <PickerTrigger
      variant={variant}
      disabled={disabled}
      className={className}
      id={id}
      data-testid={testId}
      aria-label={ariaLabel ?? (value ? `${value.key} ${value.summary}` : placeholder)}
    >
      {value ? (
        <>
          <IssueTypeIcon type={value.type} title={false} />
          {variant === 'compact' ? (
            <span className="text-xs font-medium text-fg-muted">{value.key}</span>
          ) : (
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-xs font-medium text-fg-muted">{value.key}</span>
              <span className="truncate">{value.summary}</span>
            </span>
          )}
        </>
      ) : (
        <PickerPlaceholder>{placeholder}</PickerPlaceholder>
      )}
    </PickerTrigger>
  )
  if (disabled) return triggerEl

  return (
    <Combobox
      trigger={triggerEl}
      options={options}
      selected={value?.id ?? (allowNone ? NONE : null)}
      query={query}
      onQueryChange={setQuery}
      searchable
      searchPlaceholder={searchPlaceholder}
      loading={results.isFetching}
      emptyText={results.isLoading ? 'Searching…' : 'No matching issues'}
      width={420}
      align={align}
      open={open}
      onOpenChange={(next) => {
        if (next) setQuery('')
        if (openProp === undefined) setUncontrolledOpen(next)
        onOpenChange?.(next)
      }}
      aria-label="Issues"
      onSelect={(o) => {
        if (o.value === NONE) {
          if (value) onChange(null)
          return
        }
        const issue = results.data?.items.find((i) => i.id === o.value)
        if (issue && issue.id !== value?.id) onChange(issue)
      }}
    />
  )
}
