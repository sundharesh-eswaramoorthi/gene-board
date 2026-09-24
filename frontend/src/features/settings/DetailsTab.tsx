import { Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useUpdateProject } from '@/api/projects'
import { useSprints } from '@/api/sprints'
import type { ID, Project, ProjectType, Sprint, SprintState, UpdateProjectInput } from '@/api/types'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { UserPicker } from '@/components/issue/UserPicker'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Textarea } from '@/components/ui/Textarea'
import { toast, toastError } from '@/components/ui/toast'
import { ProjectTypeCards } from '@/features/projects/ProjectTypeCards'
import { charCount } from '@/lib/chars'
import { formatDate } from '@/lib/dates'
import { fieldErrors } from '@/lib/errors'
import { PROJECT_TYPE_META } from '@/lib/issueMeta'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { SettingsSection } from './SettingsSection'

const NAME_MAX = 80
/** Server limit for project descriptions, in characters. */
export const PROJECT_DESCRIPTION_MAX = 4000

interface Draft {
  name: string
  description: string
  type: ProjectType
  leadId: ID | null
}

function draftOf(project: Project): Draft {
  return { name: project.name, description: project.description, type: project.type, leadId: project.lead?.id ?? null }
}

/**
 * `draft` after the project changed from `before` to `after` (someone else saved): each field the
 * admin hasn't changed takes the new value, so saving never writes another field's old value back.
 */
function rebase(draft: Draft, before: Draft, after: Draft): Draft {
  // Text is compared trimmed, like changesOf and the server: whitespace alone is no edit.
  const sameText = (a: string, b: string) => a.trim() === b.trim()
  return {
    name: sameText(draft.name, before.name) ? after.name : draft.name,
    description: sameText(draft.description, before.description) ? after.description : draft.description,
    type: draft.type === before.type ? after.type : draft.type,
    leadId: draft.leadId === before.leadId ? after.leadId : draft.leadId,
  }
}

/** The PATCH body for what the draft changed (only changed fields, PATCH semantics). */
function changesOf(draft: Draft, project: Project): UpdateProjectInput {
  const patch: UpdateProjectInput = {}
  if (draft.name.trim() !== project.name) patch.name = draft.name.trim()
  if (draft.description.trim() !== project.description.trim()) patch.description = draft.description.trim()
  if (draft.type !== project.type) patch.type = draft.type
  if (draft.leadId !== (project.lead?.id ?? null)) patch.leadId = draft.leadId
  return patch
}

const TYPE_SWITCH_HINT: Record<ProjectType, string> = {
  scrum: 'Scrum boards show the active sprint; plan sprints from the backlog.',
  kanban: 'Kanban boards show all work without sprints; sprint planning is hidden.',
}

const OPEN_SPRINT_STATES: readonly SprintState[] = ['active', 'planned']

/** "GB Sprint 2 (active) and GB Sprint 3 (planned)". */
function listSprints(sprints: readonly { name: string; state: SprintState }[]): string {
  const names = sprints.map((s) => `${s.name} (${s.state})`)
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Props of {@link DetailsTab}. */
export interface DetailsTabProps {
  project: Project
  isAdmin: boolean
}

/** Project details (name, key, type, lead, description) and, for admins, the danger zone. */
export function DetailsTab({ project, isAdmin }: DetailsTabProps) {
  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? <DetailsForm project={project} /> : <DetailsReadOnly project={project} />}
      {isAdmin && <DangerZone project={project} />}
    </div>
  )
}

function DetailsForm({ project }: { project: Project }) {
  const update = useUpdateProject(project.key)
  const confirm = useConfirm()
  const [draft, setDraft] = useState(() => draftOf(project))
  const [syncedProject, setSyncedProject] = useState(project)
  const [nameError, setNameError] = useState<string | null>(null)
  const [checkingSprints, setCheckingSprints] = useState(false)

  // Someone else saved (realtime refresh): adopt their values in the fields without local edits.
  if (syncedProject !== project) {
    setSyncedProject(project)
    setDraft(rebase(draft, draftOf(syncedProject), draftOf(project)))
  }

  const patch = changesOf(draft, project)
  const dirty = Object.keys(patch).length > 0
  const trimmedName = draft.name.trim()
  // Only a name being changed is checked (a saved one is valid), in characters like the server.
  const nameProblem =
    patch.name === undefined
      ? null
      : !patch.name
        ? 'Name is required'
        : charCount(patch.name) > NAME_MAX
          ? `Name must be at most ${NAME_MAX} characters`
          : null

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((d) => ({ ...d, [field]: value }))

  // Switching a Scrum project to Kanban leaves its open sprints without sprint controls
  // (they can still be completed or deleted from the Kanban backlog).
  const toKanban = project.type === 'scrum' && draft.type === 'kanban'
  const openSprints = useSprints(project.key, OPEN_SPRINT_STATES, { enabled: toKanban })
  const leftover = toKanban ? (openSprints.data ?? []) : []
  const typeHint =
    draft.type === project.type
      ? undefined
      : leftover.length > 0
        ? `${TYPE_SWITCH_HINT.kanban} ${listSprints(leftover)} will stay open — complete or delete ${leftover.length === 1 ? 'it' : 'them'} in the backlog first, or afterwards from the Kanban backlog.`
        : TYPE_SWITCH_HINT[draft.type]

  /**
   * The open sprints for the switch to Kanban, waiting for the lookup if it is still running
   * (`leftover` is empty until then); null when it failed.
   */
  const settledOpenSprints = async (): Promise<Sprint[] | null> => {
    if (openSprints.isSuccess) return openSprints.data
    const result = await openSprints.refetch({ cancelRefetch: false })
    return result.isSuccess ? result.data : null
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!dirty || update.isPending || checkingSprints) return
    if (nameProblem) {
      setNameError(nameProblem)
      return
    }
    if (patch.type === 'kanban') {
      // The fields are locked while the lookup runs, so what is confirmed and saved below (this
      // render's `patch`) is still what the form shows.
      if (!openSprints.isSuccess) setCheckingSprints(true)
      const open = await settledOpenSprints()
      setCheckingSprints(false)
      if (open === null || open.length > 0) {
        const proceed = await confirm(
          open === null
            ? {
                title: 'Switch to Kanban?',
                description:
                  'Couldn’t check this project for open sprints. Kanban boards don’t show sprints: issues in an open sprint stay in it until you complete or delete it from the Kanban backlog.',
                confirmLabel: 'Switch to Kanban',
              }
            : {
                title: 'Switch to Kanban with open sprints?',
                description: `${listSprints(open)} ${open.length === 1 ? 'is' : 'are'} still open. Kanban boards don’t show sprints: their issues stay in ${open.length === 1 ? 'it' : 'them'} until you complete or delete ${open.length === 1 ? 'it' : 'them'} from the Kanban backlog.`,
                confirmLabel: 'Switch to Kanban',
              },
        )
        if (!proceed) return
      }
    }
    update.mutate(patch, {
      onSuccess: () => toast.success('Project details saved'),
      onError: (err) => {
        const fields = fieldErrors(err)
        if (fields.name) setNameError(`Name ${fields.name}`)
        else toastError(err, 'Couldn’t save the project')
      },
    })
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <SettingsSection
        title="Details"
        description="How the project appears across Gene Board."
        footer={
          <>
            <Button
              variant="subtle"
              disabled={!dirty || update.isPending || checkingSprints}
              onClick={() => setDraft(draftOf(project))}
            >
              Discard changes
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty}
              loading={update.isPending || checkingSprints}
              data-testid="project-details-save"
            >
              Save changes
            </Button>
          </>
        }
      >
        <fieldset disabled={checkingSprints} className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-3">
            <ProjectAvatar project={{ key: project.key, name: trimmedName || project.name }} size="xl" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{trimmedName || project.name}</p>
              <p className="text-xs text-fg-muted">Created {formatDate(project.createdAt)}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Name" required error={nameError ?? undefined}>
              <Input
                value={draft.name}
                maxLength={NAME_MAX}
                onChange={(e) => {
                  set('name', e.target.value)
                  setNameError(null)
                }}
                onBlur={() => setNameError(nameProblem)}
                data-testid="project-details-name"
              />
            </Field>
            <Field label="Key" hint="Keys can’t be changed.">
              <Input value={project.key} disabled readOnly className="font-mono" />
            </Field>
          </div>

          <ProjectTypeCards
            value={draft.type}
            onChange={(type) => set('type', type)}
            disabled={checkingSprints}
            hint={typeHint}
          />

          <Field label="Project lead" hint="The lead is shown on the projects list. Leads must be project members.">
            <UserPicker
              projectKey={project.key}
              value={draft.leadId ?? null}
              onChange={(leadId) => set('leadId', leadId)}
              unassignedLabel="No lead"
              fieldLabel="Project lead"
              data-testid="project-details-lead"
            />
          </Field>

          <Field label="Description">
            <Textarea
              value={draft.description}
              maxLength={PROJECT_DESCRIPTION_MAX}
              minRows={3}
              maxRows={12}
              placeholder="What is this project about?"
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        </fieldset>
      </SettingsSection>
    </form>
  )
}

function DetailsReadOnly({ project }: { project: Project }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Name', value: project.name },
    { label: 'Key', value: <span className="font-mono">{project.key}</span> },
    { label: 'Type', value: `${PROJECT_TYPE_META[project.type].label} — ${PROJECT_TYPE_META[project.type].description}` },
    { label: 'Project lead', value: <UserAvatar user={project.lead} size="sm" showName emptyLabel="No lead" /> },
    {
      label: 'Description',
      value: project.description ? (
        <span className="whitespace-pre-wrap">{project.description}</span>
      ) : (
        <span className="text-fg-subtle">No description</span>
      ),
    },
    { label: 'Created', value: formatDate(project.createdAt) },
  ]
  return (
    <SettingsSection title="Details" description="How the project appears across Gene Board.">
      <div className="mb-4 flex items-center gap-3">
        <ProjectAvatar project={project} size="xl" />
        <p className="truncate text-sm font-semibold text-fg">{project.name}</p>
      </div>
      <dl className="divide-y divide-border rounded-md border border-border">
        {rows.map(({ label, value }) => (
          <div key={label} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-xs font-semibold text-fg-muted sm:pt-0.5">{label}</dt>
            <dd className="min-w-0 text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  )
}

function DangerZone({ project }: { project: Project }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <SettingsSection
        tone="danger"
        title="Danger zone"
        description="Deleting a project removes all of its issues, sprints, comments and history for everyone."
        actions={
          <Button variant="danger" icon={<Trash2 />} onClick={() => setOpen(true)} data-testid="project-delete">
            Delete project
          </Button>
        }
      />
      <DeleteProjectDialog project={project} open={open} onOpenChange={setOpen} />
    </>
  )
}
