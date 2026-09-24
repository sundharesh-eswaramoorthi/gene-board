import { FolderPlus } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { useCreateIssue, useIssue } from '@/api/issues'
import type { IssueType, Priority, UserSummary } from '@/api/types'
import { useIssueModal, type CreateIssueDefaults } from '@/app/ModalsProvider'
import { useAuth } from '@/auth/AuthProvider'
import {
  LabelMultiSelect,
  ParentPicker,
  PrioritySelect,
  ProjectSelect,
  SprintSelect,
  TypeSelect,
  UserPicker,
  type IssuePickerValue,
} from '@/components/issue'
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Kbd,
  buttonClasses,
  modKeyLabel,
  useConfirm,
} from '@/components/ui'
import { fieldErrors } from '@/lib/errors'
import { useLocalStorageState } from '@/lib/hooks'
import { allowedParentTypes, isStandardType } from '@/lib/issueMeta'
import { isIssueKey } from '@/lib/projectKey'
import { announceCreated } from './create/announceCreated'
import {
  buildCreateInput,
  emptyScopedFields,
  mapServerFieldErrors,
  MAX_SUMMARY_LENGTH,
  scopedFieldsFromDefaults,
  validateCreateForm,
  type CreateErrors,
  type CreateField,
  type ParentChoice,
  type ProjectScopedFields,
} from './create/createIssueForm'
import { canCreateIssuesIn, useProjectChoice } from './create/useProjectChoice'
import { toastSaveError } from './shared/errors'
import { MarkdownEditor } from './shared/MarkdownEditor'
import { MAX_DESCRIPTION_LENGTH } from './shared/limits'

/** localStorage key of the last issue type the user created (Jira pre-selects it next time). */
const LAST_TYPE_KEY = 'gb-create-issue-type'

function rememberedType(value: unknown): IssueType {
  return value === 'epic' || value === 'story' || value === 'task' || value === 'bug' ? value : 'story'
}

/**
 * Create issue modal (fixed contract; ModalsProvider mounts a fresh instance per
 * `openCreateIssue(defaults)` call). Project, type, summary, description, assignee, priority,
 * labels, epic / parent (required for subtasks), sprint (Scrum, standard types), story points
 * and due date. Enter in the summary or ⌘/Ctrl+Enter anywhere submits; "Create another" keeps
 * the dialog open with the other fields filled in.
 */
export function CreateIssueModal({
  open,
  defaults,
  onClose,
}: {
  open: boolean
  defaults: CreateIssueDefaults
  onClose: () => void
}) {
  const { user } = useAuth()
  const { openIssue } = useIssueModal()
  const confirm = useConfirm()
  const create = useCreateIssue()
  const projects = useProjectChoice(defaults)
  const projectKey = projects.projectKey
  const summaryRef = useRef<HTMLInputElement>(null)
  const storyPointsRef = useRef<HTMLInputElement>(null)
  const dueDateRef = useRef<HTMLInputElement>(null)

  const [lastType, setLastType] = useLocalStorageState<IssueType>(LAST_TYPE_KEY, 'story')
  const [typeChoice, setTypeChoice] = useState<IssueType | null>(defaults.type ?? null)
  // Only a type the user picked becomes the next default (not one preset by the caller).
  const [typePickedByUser, setTypePickedByUser] = useState(false)
  const [summary, setSummary] = useState(defaults.summary ?? '')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [storyPoints, setStoryPoints] = useState('')
  const [dueDate, setDueDate] = useState('')
  // The inputs hold text the browser can't parse (their value then reads as '').
  const [storyPointsUnparsable, setStoryPointsUnparsable] = useState(false)
  const [dueDateUnparsable, setDueDateUnparsable] = useState(false)
  const [scoped, setScoped] = useState<ProjectScopedFields>(() => scopedFieldsFromDefaults(defaults))
  const [createAnother, setCreateAnother] = useState(false)
  const [createdCount, setCreatedCount] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [pointsTouched, setPointsTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<CreateErrors>({})

  // Values chosen for another project (e.g. the defaults' project wasn't creatable) don't apply.
  const fields = scoped.projectKey === projectKey ? scoped : emptyScopedFields(projectKey)
  const updateScoped = (patch: Partial<Omit<ProjectScopedFields, 'projectKey'>>) =>
    setScoped((prev) => ({ ...(prev.projectKey === projectKey ? prev : emptyScopedFields(projectKey)), ...patch }))

  // A parent passed in `defaults` only has id + key (and maybe its type): load it for its
  // summary and type.
  const seedKey = fields.parent && !fields.parent.summary && isIssueKey(fields.parent.key) ? fields.parent.key : null
  const parentLookup = useIssue(seedKey)
  const parent = useMemo<ParentChoice | null>(() => {
    const p = fields.parent
    const loaded = parentLookup.data
    if (!p || p.summary || !loaded || loaded.id !== p.id) return p
    return { id: loaded.id, key: loaded.key, summary: loaded.summary, type: loaded.type }
  }, [fields.parent, parentLookup.data])
  // Until a seeded parent's type is known the form can't tell a subtask from a standard
  // issue: submitting waits for the lookup.
  const parentTypePending = defaults.parentId != null && parent?.type == null && seedKey != null && parentLookup.isPending

  const fallbackType = rememberedType(lastType)
  const standardFallback: IssueType = isStandardType(fallbackType) ? fallbackType : 'story'
  // An epic's child is a story/task/bug; a standard issue's child is a subtask. While the
  // parent's type is unknown, assume the common case (a standard issue under an epic).
  const inferredType: IssueType =
    defaults.parentId != null
      ? parent?.type == null || parent.type === 'epic'
        ? standardFallback
        : 'subtask'
      : fallbackType
  const type = typeChoice ?? inferredType
  const sprintApplies = projects.project?.type === 'scrum' && isStandardType(type)

  const values = {
    projectKey,
    type,
    summary,
    description,
    priority,
    fields,
    parent,
    sprintApplies,
    storyPoints,
    dueDate,
    storyPointsUnparsable,
    dueDateUnparsable,
  }
  const clientErrors = validateCreateForm(values)
  const errorFor = (field: CreateField): string | undefined =>
    serverErrors[field] ??
    (submitted || (field === 'storyPoints' && pointsTouched) ? clientErrors[field] : undefined)
  const clearServerError = (field: CreateField) =>
    setServerErrors((prev) => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })

  const changeProject = (key: string) => {
    if (key === projectKey) return
    projects.choose(key)
    setScoped(emptyScopedFields(key))
    setServerErrors({})
  }

  const changeType = (next: IssueType) => {
    setTypeChoice(next)
    setTypePickedByUser(true)
    clearServerError('type')
    clearServerError('parent')
    const parentTypes = allowedParentTypes(next)
    if (parent && (parentTypes.length === 0 || (parent.type && !parentTypes.includes(parent.type)))) {
      updateScoped({ parent: null })
    }
  }

  const isDirty =
    summary.trim() !== (defaults.summary ?? '').trim() || (createdCount === 0 && description.trim() !== '')

  const requestClose = async () => {
    if (create.isPending) return
    if (isDirty) {
      const discard = await confirm({
        title: 'Discard this issue?',
        description: 'The details you entered haven’t been saved.',
        confirmLabel: 'Discard',
      })
      if (!discard) return
    }
    onClose()
  }

  const submit = async () => {
    if (create.isPending || parentTypePending) return
    setSubmitted(true)
    setServerErrors({})
    // Re-read the inputs: typing "-" into an empty number input changes no value (so no
    // change event), yet leaves text the browser can't parse.
    const pointsUnparsable = storyPointsRef.current?.validity.badInput ?? false
    const dueUnparsable = dueDateRef.current?.validity.badInput ?? false
    setStoryPointsUnparsable(pointsUnparsable)
    setDueDateUnparsable(dueUnparsable)
    const errors = validateCreateForm({
      ...values,
      storyPointsUnparsable: pointsUnparsable,
      dueDateUnparsable: dueUnparsable,
    })
    if (!projectKey || Object.keys(errors).length > 0) {
      if (errors.summary) summaryRef.current?.focus()
      return
    }
    try {
      const issue = await create.mutateAsync(buildCreateInput({ ...values, projectKey }))
      announceCreated(issue, openIssue)
      if (typePickedByUser && type !== 'subtask') setLastType(type)
      defaults.onCreated?.(issue)
      setCreatedCount((n) => n + 1)
      if (createAnother) {
        setSummary('')
        setSubmitted(false)
        requestAnimationFrame(() => summaryRef.current?.focus())
      } else {
        onClose()
      }
    } catch (err) {
      setServerErrors(mapServerFieldErrors(fieldErrors(err)))
      toastSaveError(err, 'Couldn’t create the issue')
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const me: UserSummary | null = user ? { id: user.id, name: user.name, email: user.email } : null
  const noProjects = !projects.isLoading && !projects.error && projects.creatable.length === 0
  const blocked = noProjects || !!projects.error
  const parentLabel = type === 'subtask' ? 'Parent' : 'Epic'
  const parentValue: IssuePickerValue | null = parent
    ? {
        id: parent.id,
        key: parent.key || `#${parent.id}`,
        summary: parent.summary || (parentLookup.isFetching ? 'Loading…' : ''),
        type: parent.type ?? (type === 'subtask' ? 'story' : 'epic'),
      }
    : null

  let body
  if (projects.error) {
    body = <ErrorState error={projects.error} title="Couldn’t load your projects" onRetry={projects.retry} />
  } else if (noProjects) {
    body = (
      <EmptyState
        icon={<FolderPlus />}
        title="No project to create issues in"
        description="You need member access to a project. Create one, or ask a project admin to add you."
        action={
          <Link to="/projects?create=1" onClick={onClose} className={buttonClasses({ variant: 'primary' })}>
            Create project
          </Link>
        }
      />
    )
  } else {
    body = (
      // ⌘/Ctrl+Enter submits from any field (pickers' popovers bubble here through the portal).
      // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={onKeyDown} className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field label="Project" required error={errorFor('project')}>
          <ProjectSelect
            value={projectKey}
            onChange={changeProject}
            filter={canCreateIssuesIn}
            placeholder={projects.isLoading ? 'Loading projects…' : 'Select project'}
          />
        </Field>
        <Field label="Issue type" required error={errorFor('type')}>
          <TypeSelect value={type} onChange={changeType} />
        </Field>

        <Field label="Summary" required error={errorFor('summary')} className="sm:col-span-2">
          <Input
            ref={summaryRef}
            data-autofocus
            data-testid="create-issue-summary"
            value={summary}
            maxLength={MAX_SUMMARY_LENGTH}
            placeholder="What needs to be done?"
            autoComplete="off"
            onChange={(e) => {
              setSummary(e.target.value)
              clearServerError('summary')
            }}
          />
        </Field>

        <Field label="Description" error={errorFor('description')} className="sm:col-span-2">
          <MarkdownEditor
            value={description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onChange={(next) => {
              setDescription(next)
              clearServerError('description')
            }}
            minRows={4}
            maxRows={14}
            placeholder="Add more detail: context, acceptance criteria, steps to reproduce… (Markdown supported)"
          />
        </Field>

        <Field
          label="Assignee"
          error={errorFor('assignee')}
          labelAside={
            me &&
            projectKey &&
            fields.assignee?.id !== me.id && (
              <button
                type="button"
                onClick={() => {
                  updateScoped({ assignee: me })
                  clearServerError('assignee')
                }}
                className="rounded-sm text-xs font-medium text-primary hover:underline"
              >
                Assign to me
              </button>
            )
          }
        >
          <UserPicker
            projectKey={projectKey ?? ''}
            value={fields.assignee}
            disabled={!projectKey}
            onChange={(userId, picked) => {
              updateScoped({ assignee: userId == null ? null : (picked ?? { id: userId, name: 'Unknown user', email: '' }) })
              clearServerError('assignee')
            }}
          />
        </Field>
        <Field label="Priority" error={errorFor('priority')}>
          <PrioritySelect
            value={priority}
            onChange={(next) => {
              setPriority(next)
              clearServerError('priority')
            }}
          />
        </Field>

        <Field label="Labels" error={errorFor('labels')} className="sm:col-span-2">
          <LabelMultiSelect
            projectKey={projectKey ?? ''}
            value={fields.labelIds}
            disabled={!projectKey}
            onChange={(labelIds) => {
              updateScoped({ labelIds })
              clearServerError('labels')
            }}
          />
        </Field>

        {type !== 'epic' && (
          <Field
            label={parentLabel}
            required={type === 'subtask'}
            error={errorFor('parent')}
            hint={type === 'subtask' ? 'The story, task or bug this subtask belongs to.' : undefined}
            className={sprintApplies ? undefined : 'sm:col-span-2'}
          >
            <ParentPicker
              projectKey={projectKey ?? ''}
              childType={type}
              value={parentValue}
              disabled={!projectKey}
              onChange={(picked) => {
                updateScoped({
                  parent: picked ? { id: picked.id, key: picked.key, summary: picked.summary, type: picked.type } : null,
                })
                clearServerError('parent')
              }}
            />
          </Field>
        )}
        {sprintApplies && (
          <Field label="Sprint" error={errorFor('sprint')}>
            <SprintSelect
              projectKey={projectKey ?? ''}
              value={fields.sprintId}
              disabled={!projectKey}
              onChange={(sprintId) => {
                updateScoped({ sprintId })
                clearServerError('sprint')
              }}
            />
          </Field>
        )}

        <Field label="Story points" error={errorFor('storyPoints')}>
          <Input
            ref={storyPointsRef}
            type="number"
            inputMode="decimal"
            min={0}
            max={1000}
            step="any"
            placeholder="e.g. 3"
            value={storyPoints}
            onBlur={(e) => {
              setPointsTouched(true)
              setStoryPointsUnparsable(e.currentTarget.validity.badInput)
            }}
            onChange={(e) => {
              setStoryPoints(e.target.value)
              setStoryPointsUnparsable(e.currentTarget.validity.badInput)
              clearServerError('storyPoints')
            }}
          />
        </Field>
        <Field label="Due date" error={errorFor('dueDate')}>
          <Input
            ref={dueDateRef}
            type="date"
            value={dueDate}
            onBlur={(e) => setDueDateUnparsable(e.currentTarget.validity.badInput)}
            onChange={(e) => {
              setDueDate(e.target.value)
              setDueDateUnparsable(e.currentTarget.validity.badInput)
              clearServerError('dueDate')
            }}
          />
        </Field>
        {errorFor('status') && <p role="alert" className="text-xs text-danger sm:col-span-2">{errorFor('status')}</p>}
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void requestClose()
      }}
      title="Create issue"
      description={
        <>
          Required fields are marked with an asterisk <span className="text-danger">*</span>
        </>
      }
      size="lg"
      data-testid="create-issue-modal"
      preventClose={create.isPending}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      footerStart={
        !blocked && <Checkbox checked={createAnother} onCheckedChange={setCreateAnother} label="Create another" />
      }
      footer={
        <>
          {!blocked && (
            <span className="mr-1 hidden items-center gap-1 text-2xs text-fg-subtle sm:flex" aria-hidden>
              <Kbd>{modKeyLabel}</Kbd>
              <Kbd>Enter</Kbd>
            </span>
          )}
          <Button variant="subtle" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={blocked || parentTypePending}
            data-testid="create-issue-submit"
          >
            Create
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}
