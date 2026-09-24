import { CircleCheck } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useCreateProject, useProjects } from '@/api/projects'
import type { ProjectType } from '@/api/types'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { toast, toastError } from '@/components/ui/toast'
import { fieldErrors, isApiStatus } from '@/lib/errors'
import { validateProjectKey } from '@/lib/projectKey'
import { sanitizeKeyInput, suggestUniqueKey } from './projectKeys'
import { ProjectTypeCards } from './ProjectTypeCards'

const NAME_MAX = 80

/** Props of {@link CreateProjectDialog}. */
export interface CreateProjectDialogProps {
  open: boolean
  onClose: () => void
}

type ServerErrors = Partial<Record<'name' | 'key' | 'description' | 'type', string>>

/**
 * "Create project": name, key (suggested from the name until edited, validated live against
 * `^[A-Z][A-Z0-9]{1,9}$`), Scrum/Kanban type cards and description. On success it opens the
 * new project's board; a taken key (409) is reported on the key field.
 */
export function CreateProjectDialog({ open, onClose }: CreateProjectDialogProps) {
  const navigate = useNavigate()
  const projects = useProjects()
  const createProject = useCreateProject()

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [keyDraft, setKeyDraft] = useState<string | null>(null)
  const [type, setType] = useState<ProjectType>('scrum')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<ServerErrors>({})

  const takenKeys = useMemo(() => new Set((projects.data ?? []).map((p) => p.key)), [projects.data])
  const key = keyDraft ?? suggestUniqueKey(name, takenKeys)
  const keyEdited = keyDraft !== null

  const trimmedName = name.trim()
  const nameProblem = !trimmedName
    ? 'Name is required'
    : trimmedName.length > NAME_MAX
      ? `Name must be at most ${NAME_MAX} characters`
      : null
  const keyProblem = validateProjectKey(key) ?? (takenKeys.has(key) ? 'A project with this key already exists' : null)

  const nameError = serverErrors.name ?? ((nameTouched || submitted) && nameProblem ? nameProblem : undefined)
  const keyError =
    serverErrors.key ?? ((keyEdited || submitted || (trimmedName.length >= 2 && key.length > 0)) && keyProblem ? keyProblem : undefined)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (nameProblem || keyProblem || createProject.isPending) return
    createProject.mutate(
      { key, name: trimmedName, type, description: description.trim() || undefined },
      {
        onSuccess: (project) => {
          toast.success(`Project “${project.name}” created`)
          onClose()
          navigate(`/projects/${project.key}/board`)
        },
        onError: (err) => {
          if (isApiStatus(err, 409)) {
            setServerErrors({ key: 'That key is already in use. Choose a different one.' })
            return
          }
          const fields = fieldErrors(err)
          const mapped: ServerErrors = {
            name: fields.name && `Name ${fields.name}`,
            key: fields.key && `Key ${fields.key}`,
            description: fields.description && `Description ${fields.description}`,
            type: fields.type && `Type ${fields.type}`,
          }
          if (Object.values(mapped).some(Boolean)) setServerErrors(mapped)
          else toastError(err, 'Couldn’t create the project')
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Create project"
      description="Projects hold your team’s issues, board and backlog."
      size="md"
      onSubmit={submit}
      preventClose={createProject.isPending}
      data-testid="create-project-dialog"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={createProject.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={createProject.isPending} data-testid="create-project-submit">
            Create project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={nameError}>
          <Input
            data-autofocus
            value={name}
            maxLength={NAME_MAX}
            placeholder="e.g. Gene Board"
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value)
              setServerErrors(({ name: _drop, ...rest }) => rest)
            }}
            onBlur={() => setNameTouched(true)}
            data-testid="create-project-name"
          />
        </Field>

        <Field
          label="Key"
          required
          error={keyError}
          hint={
            key && !keyProblem ? (
              <span className="inline-flex items-center gap-1">
                <CircleCheck className="size-3.5 text-success" aria-hidden />
                Issues will be numbered {key}-1, {key}-2, … The key can’t be changed later.
              </span>
            ) : (
              '2–10 letters or digits, starting with a letter. It prefixes every issue key.'
            )
          }
        >
          <Input
            value={key}
            placeholder="e.g. GB"
            autoComplete="off"
            spellCheck={false}
            maxLength={10}
            className="font-mono uppercase"
            leadingIcon={key ? <ProjectAvatar project={{ key, name: trimmedName || key }} size="sm" /> : undefined}
            onChange={(e) => {
              setKeyDraft(sanitizeKeyInput(e.target.value))
              setServerErrors(({ key: _drop, ...rest }) => rest)
            }}
            data-testid="create-project-key"
          />
        </Field>

        <ProjectTypeCards value={type} onChange={setType} legend="Template" />
        {serverErrors.type && <p className="-mt-2 text-xs text-danger">{serverErrors.type}</p>}

        <Field label="Description" error={serverErrors.description} hint="Optional. What is this project about?">
          <Textarea
            value={description}
            maxLength={4000}
            minRows={3}
            maxRows={8}
            onChange={(e) => {
              setDescription(e.target.value)
              setServerErrors(({ description: _drop, ...rest }) => rest)
            }}
          />
        </Field>
      </div>
    </Dialog>
  )
}
