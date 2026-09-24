import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEpics } from '@/api/board'
import { useLabels } from '@/api/labels'
import { useMembers } from '@/api/members'
import { useProjects } from '@/api/projects'
import { useSprints } from '@/api/sprints'
import { useStatuses } from '@/api/statuses'
import type { ID, IssueType, Priority, Project, StatusCategory } from '@/api/types'
import { useCurrentUser } from '@/auth/AuthProvider'
import { IssueTypeIcon } from '@/components/issue/IssueTypeIcon'
import { LabelChip } from '@/components/issue/LabelChip'
import { PriorityIcon } from '@/components/issue/PriorityIcon'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { StatusLozenge } from '@/components/issue/StatusLozenge'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { Button } from '@/components/ui/Button'
import type { ComboboxOption } from '@/components/ui/Combobox'
import { SearchInput } from '@/components/ui/Input'
import { formatDateRange } from '@/lib/dates'
import {
  ISSUE_TYPE_META,
  ISSUE_TYPES,
  PRIORITIES,
  PRIORITY_META,
  SPRINT_STATE_META,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_META,
} from '@/lib/issueMeta'
import {
  activeFilterCount,
  withoutProjectScopedFilters,
  type AssigneeFilter,
  type IssueFilters,
  type ReporterFilter,
  type SprintFilter,
} from './issueFilters'
import { FilterMenu } from './FilterMenu'
import type { FilterUpdateOptions } from './useIssueFilters'

/** Props of {@link IssueFilterBar}. */
export interface IssueFilterBarProps {
  filters: IssueFilters
  onChange: (patch: Partial<IssueFilters>, options?: FilterUpdateOptions) => void
  onClear: () => void
  /** The scoped route's project (null on the global `/issues` route). */
  project: Project | null
}

/**
 * The issue search toolbar: text search plus filter menus. Searches limited to one project —
 * a project's route, or the global route with a project picked — offer that project's
 * statuses, members, labels, epics and sprints; across projects the status filter offers the
 * categories, the people filters Me (and Unassigned), and the sprint filter the active sprints
 * or the backlog.
 */
export function IssueFilterBar({ filters, onChange, onClear, project }: IssueFilterBarProps) {
  const active = activeFilterCount(filters)
  const projects = useProjects({ enabled: !project && filters.project != null })
  const scope: Pick<Project, 'key' | 'type'> | null =
    project ?? (filters.project ? { key: filters.project, type: projects.data?.find((p) => p.key === filters.project)?.type ?? 'scrum' } : null)
  const scopeKey = scope?.key ?? null
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Issue filters">
      <SearchBox value={filters.q} onCommit={(q, options) => onChange({ q }, options)} />
      {!project && (
        <ProjectFilter
          value={filters.project}
          onChange={(key) => onChange({ project: key, ...withoutProjectScopedFilters(filters) })}
        />
      )}
      <TypeFilter value={filters.types} onChange={(types) => onChange({ types })} />
      <StatusFilter
        projectKey={scopeKey}
        categories={filters.categories}
        statusIds={filters.statusIds}
        onChange={(categories, statusIds) => onChange({ categories, statusIds })}
      />
      <PriorityFilter value={filters.priorities} onChange={(priorities) => onChange({ priorities })} />
      <AssigneeFilterMenu
        projectKey={scopeKey}
        value={filters.assignees}
        onChange={(assignees) => onChange({ assignees })}
      />
      <ReporterFilterMenu
        projectKey={scopeKey}
        value={filters.reporters}
        onChange={(reporters) => onChange({ reporters })}
      />
      {scopeKey && (
        <LabelFilter projectKey={scopeKey} value={filters.labelIds} onChange={(labelIds) => onChange({ labelIds })} />
      )}
      {scopeKey && <EpicFilter projectKey={scopeKey} value={filters.epic} onChange={(epic) => onChange({ epic })} />}
      {scope?.type !== 'kanban' && (
        <SprintFilterMenu projectKey={scopeKey} value={filters.sprint} onChange={(sprint) => onChange({ sprint })} />
      )}
      <ResolvedFilter value={filters.resolved} onChange={(resolved) => onChange({ resolved })} />
      {active > 0 && (
        <Button size="sm" variant="subtle" icon={<X />} onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/**
 * Text search that writes to the URL 350ms after typing stops (Enter commits at once). The
 * first write of a typing session pushes a history entry; later ones replace it, so Back
 * returns to the search before the user started typing rather than stepping through letters.
 */
function SearchBox({ value, onCommit }: { value: string; onCommit: (q: string, options: FilterUpdateOptions) => void }) {
  const [draft, setDraft] = useState(value)
  const [seenValue, setSeenValue] = useState(value)
  // The URL changed from outside (Back button, top-nav search): show the new text.
  if (value !== seenValue) {
    setSeenValue(value)
    if (value !== draft.trim()) setDraft(value)
  }

  const timer = useRef<number | undefined>(undefined)
  const pushedThisSession = useRef(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const commit = (text: string) => {
    window.clearTimeout(timer.current)
    const q = text.trim()
    if (q === value) return
    onCommit(q, { replace: pushedThisSession.current })
    pushedThisSession.current = true
  }

  return (
    <SearchInput
      value={draft}
      onChange={(v) => {
        setDraft(v)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => commit(v), 350)
      }}
      onClear={() => {
        setDraft('')
        commit('')
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(draft)
        }
      }}
      onBlur={() => {
        commit(draft)
        pushedThisSession.current = false
      }}
      placeholder="Search issues"
      aria-label="Search issues by key or text"
      className="w-full sm:w-60"
      data-testid="issues-search"
    />
  )
}

function ProjectFilter({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  const projects = useProjects()
  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      (projects.data ?? []).map((p) => ({
        value: p.key,
        label: p.name,
        keywords: p.key,
        icon: <ProjectAvatar project={p} size="sm" />,
        description: p.key,
      })),
    [projects.data],
  )
  return (
    <FilterMenu
      label="Project"
      multiple={false}
      options={options}
      selected={value ? [value] : []}
      onChange={(keys) => onChange(keys[0] ?? null)}
      loading={projects.isLoading}
      emptyText="No projects"
      width={300}
    />
  )
}

const TYPE_OPTIONS: ComboboxOption<IssueType>[] = ISSUE_TYPES.map((type) => ({
  value: type,
  label: ISSUE_TYPE_META[type].label,
  icon: <IssueTypeIcon type={type} title={false} />,
}))

function TypeFilter({ value, onChange }: { value: IssueType[]; onChange: (types: IssueType[]) => void }) {
  return <FilterMenu label="Type" options={TYPE_OPTIONS} selected={value} onChange={onChange} />
}

const PRIORITY_OPTIONS: ComboboxOption<Priority>[] = PRIORITIES.map((priority) => ({
  value: priority,
  label: PRIORITY_META[priority].label,
  icon: <PriorityIcon priority={priority} />,
}))

function PriorityFilter({ value, onChange }: { value: Priority[]; onChange: (priorities: Priority[]) => void }) {
  return <FilterMenu label="Priority" options={PRIORITY_OPTIONS} selected={value} onChange={onChange} />
}

/**
 * Status filter. Values are encoded as `cat:<category>` / `status:<id>` so one menu can offer
 * both the categories (every route) and the project's own statuses (project route).
 */
function StatusFilter({
  projectKey,
  categories,
  statusIds,
  onChange,
}: {
  projectKey: string | null
  categories: StatusCategory[]
  statusIds: ID[]
  onChange: (categories: StatusCategory[], statusIds: ID[]) => void
}) {
  const statuses = useStatuses(projectKey)
  const options = useMemo(() => {
    const list: ComboboxOption<string>[] = STATUS_CATEGORIES.map((category) => ({
      value: `cat:${category}`,
      label: STATUS_CATEGORY_META[category].label,
      group: projectKey ? 'Categories' : undefined,
      render: (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${STATUS_CATEGORY_META[category].dotClassName}`} aria-hidden />
          <span className="truncate">{STATUS_CATEGORY_META[category].label}</span>
          <span className="ml-auto text-xs text-fg-subtle">Any status</span>
        </span>
      ),
    }))
    for (const status of statuses.data ?? []) {
      list.push({
        value: `status:${status.id}`,
        label: status.name,
        group: 'Statuses',
        render: (
          <span className="flex min-w-0 flex-1">
            <StatusLozenge status={status} />
          </span>
        ),
      })
    }
    return list
  }, [statuses.data, projectKey])

  const selected = [...categories.map((c) => `cat:${c}`), ...statusIds.map((id) => `status:${id}`)]
  return (
    <FilterMenu
      label="Status"
      options={options}
      selected={selected}
      loading={!!projectKey && statuses.isLoading}
      onChange={(values) => {
        const nextCategories: StatusCategory[] = []
        const nextIds: ID[] = []
        for (const v of values) {
          const [kind, raw] = v.split(':')
          if (kind === 'cat') nextCategories.push(raw as StatusCategory)
          else if (kind === 'status') nextIds.push(Number(raw))
        }
        onChange(nextCategories, nextIds)
      }}
    />
  )
}

function AssigneeFilterMenu({
  projectKey,
  value,
  onChange,
}: {
  projectKey: string | null
  value: AssigneeFilter[]
  onChange: (assignees: AssigneeFilter[]) => void
}) {
  const me = useCurrentUser()
  const members = useMembers(projectKey)
  const options = useMemo(() => {
    const list: ComboboxOption<AssigneeFilter>[] = [
      {
        value: 'me',
        label: 'Me',
        keywords: `${me.name} ${me.email}`,
        icon: <UserAvatar user={me} size="sm" tooltip={false} />,
        description: me.name,
      },
      { value: 'none', label: 'Unassigned', icon: <UserAvatar user={null} size="sm" tooltip={false} /> },
    ]
    for (const m of members.data ?? []) {
      if (m.user.id === me.id) continue
      list.push({
        value: m.user.id,
        label: m.user.name,
        keywords: m.user.email,
        icon: <UserAvatar user={m.user} size="sm" tooltip={false} />,
      })
    }
    return list
  }, [me, members.data])
  return (
    <FilterMenu
      label="Assignee"
      options={options}
      selected={value}
      onChange={onChange}
      loading={!!projectKey && members.isLoading}
      searchPlaceholder="Search people…"
      width={280}
    />
  )
}

/** Reporter: Me, plus the project's members when the search is limited to one project. */
function ReporterFilterMenu({
  projectKey,
  value,
  onChange,
}: {
  projectKey: string | null
  value: ReporterFilter[]
  onChange: (reporters: ReporterFilter[]) => void
}) {
  const me = useCurrentUser()
  const members = useMembers(projectKey)
  const options = useMemo(() => {
    const list: ComboboxOption<ReporterFilter>[] = [
      {
        value: 'me',
        label: 'Me',
        keywords: `${me.name} ${me.email}`,
        icon: <UserAvatar user={me} size="sm" tooltip={false} />,
        description: me.name,
      },
    ]
    for (const m of members.data ?? []) {
      if (m.user.id === me.id) continue
      list.push({
        value: m.user.id,
        label: m.user.name,
        keywords: m.user.email,
        icon: <UserAvatar user={m.user} size="sm" tooltip={false} />,
      })
    }
    return list
  }, [me, members.data])
  return (
    <FilterMenu
      label="Reporter"
      options={options}
      selected={value}
      onChange={onChange}
      loading={!!projectKey && members.isLoading}
      searchPlaceholder="Search people…"
      width={280}
    />
  )
}

/** Epic: the child issues (stories, tasks, bugs) of one epic of the project. */
function EpicFilter({ projectKey, value, onChange }: { projectKey: string; value: ID | null; onChange: (epic: ID | null) => void }) {
  const epics = useEpics(projectKey)
  const options = useMemo<ComboboxOption<ID>[]>(
    () =>
      (epics.data ?? []).map(({ epic }) => ({
        value: epic.id,
        label: epic.summary,
        keywords: epic.key,
        icon: <IssueTypeIcon type="epic" title={false} />,
        description: epic.key,
      })),
    [epics.data],
  )
  return (
    <FilterMenu
      label="Epic"
      multiple={false}
      options={options}
      selected={value == null ? [] : [value]}
      onChange={(values) => onChange(values[0] ?? null)}
      loading={epics.isLoading}
      emptyText="This project has no epics"
      width={320}
    />
  )
}

function LabelFilter({ projectKey, value, onChange }: { projectKey: string; value: ID[]; onChange: (ids: ID[]) => void }) {
  const labels = useLabels(projectKey)
  const options = useMemo<ComboboxOption<ID>[]>(
    () =>
      (labels.data ?? []).map((label) => ({
        value: label.id,
        label: label.name,
        render: (
          <span className="flex min-w-0 flex-1">
            <LabelChip label={label} />
          </span>
        ),
      })),
    [labels.data],
  )
  return (
    <FilterMenu
      label="Label"
      options={options}
      selected={value}
      onChange={onChange}
      loading={labels.isLoading}
      emptyText="This project has no labels"
    />
  )
}

/**
 * Sprint: the active sprint(s) or the backlog — across projects too, like Jira's
 * openSprints() — plus the project's sprints when the search is limited to one project.
 */
function SprintFilterMenu({
  projectKey,
  value,
  onChange,
}: {
  projectKey: string | null
  value: SprintFilter | null
  onChange: (sprint: SprintFilter | null) => void
}) {
  const sprints = useSprints(projectKey)
  const options = useMemo(() => {
    const list: ComboboxOption<SprintFilter>[] = [
      { value: 'active', label: projectKey ? 'Active sprint' : 'Active sprints', description: 'Current' },
      { value: 'none', label: 'Backlog', description: 'No sprint' },
    ]
    for (const sprint of sprints.data ?? []) {
      list.push({
        value: sprint.id,
        label: sprint.name,
        group: 'Sprints',
        description:
          sprint.state === 'planned'
            ? formatDateRange(sprint.startDate, sprint.endDate) || SPRINT_STATE_META.planned.label
            : SPRINT_STATE_META[sprint.state].label,
      })
    }
    return list
  }, [sprints.data, projectKey])
  return (
    <FilterMenu
      label="Sprint"
      multiple={false}
      options={options}
      selected={value == null ? [] : [value]}
      onChange={(values) => onChange(values[0] ?? null)}
      loading={!!projectKey && sprints.isLoading}
      width={300}
    />
  )
}

type ResolvedValue = 'unresolved' | 'resolved'

const RESOLVED_OPTIONS: ComboboxOption<ResolvedValue>[] = [
  { value: 'unresolved', label: 'Unresolved', description: 'Not in a done status' },
  { value: 'resolved', label: 'Resolved', description: 'In a done status' },
]

function ResolvedFilter({ value, onChange }: { value: boolean | null; onChange: (resolved: boolean | null) => void }) {
  const selected: ResolvedValue[] = value == null ? [] : [value ? 'resolved' : 'unresolved']
  return (
    <FilterMenu
      label="Resolution"
      multiple={false}
      options={RESOLVED_OPTIONS}
      selected={selected}
      onChange={(values) => onChange(values[0] == null ? null : values[0] === 'resolved')}
    />
  )
}
