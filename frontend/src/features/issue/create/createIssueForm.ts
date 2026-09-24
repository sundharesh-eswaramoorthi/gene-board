import type { CreateIssueVariables } from '@/api/issues'
import type { ID, IssueType, Priority, UserSummary } from '@/api/types'
import type { CreateIssueDefaults } from '@/app/ModalsProvider'
import { charCount } from '@/lib/chars'
import { allowedParentTypes } from '@/lib/issueMeta'
import { normalizeKey, projectKeyOf } from '@/lib/projectKey'
import { fieldLabel } from '../shared/errors'

/** Longest summary the API accepts (SPEC §5). */
export const MAX_SUMMARY_LENGTH = 255

/** Parent chosen in the form; `type` is null while a parent passed via `defaults` is loading. */
export interface ParentChoice {
  id: ID
  key: string
  summary: string
  type: IssueType | null
}

/** Form values whose ids only make sense inside one project; reset when the project changes. */
export interface ProjectScopedFields {
  projectKey: string | null
  assignee: UserSummary | null
  labelIds: ID[]
  parent: ParentChoice | null
  sprintId: ID | null
  statusId: ID | null
}

/** Empty project-scoped values for `projectKey`. */
export function emptyScopedFields(projectKey: string | null): ProjectScopedFields {
  return { projectKey, assignee: null, labelIds: [], parent: null, sprintId: null, statusId: null }
}

/** Project-scoped values prefilled from the modal defaults (parent, sprint, status). */
export function scopedFieldsFromDefaults(defaults: CreateIssueDefaults): ProjectScopedFields {
  const projectKey = defaults.projectKey
    ? normalizeKey(defaults.projectKey)
    : defaults.parentKey
      ? projectKeyOf(defaults.parentKey)
      : null
  return {
    ...emptyScopedFields(projectKey),
    parent:
      defaults.parentId != null
        ? {
            id: defaults.parentId,
            key: defaults.parentKey ? normalizeKey(defaults.parentKey) : '',
            summary: '',
            type: defaults.parentType ?? null,
          }
        : null,
    sprintId: defaults.sprintId ?? null,
    statusId: defaults.statusId ?? null,
  }
}

/** Form fields that can show an error. */
export type CreateField =
  | 'project'
  | 'type'
  | 'summary'
  | 'description'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'parent'
  | 'sprint'
  | 'storyPoints'
  | 'dueDate'
  | 'status'

/** Error message per field. */
export type CreateErrors = Partial<Record<CreateField, string>>

const API_FIELDS: Record<string, CreateField> = {
  type: 'type',
  summary: 'summary',
  description: 'description',
  priority: 'priority',
  assigneeId: 'assignee',
  labelIds: 'labels',
  parentId: 'parent',
  sprintId: 'sprint',
  storyPoints: 'storyPoints',
  dueDate: 'dueDate',
  statusId: 'status',
}

/** Server `validation_error.fields` (`{ parentId: 'must be an epic' }`) → form field errors. */
export function mapServerFieldErrors(fields: Record<string, string>): CreateErrors {
  const errors: CreateErrors = {}
  for (const [apiField, problem] of Object.entries(fields)) {
    const field = API_FIELDS[apiField]
    if (field) errors[field] = `${fieldLabel(apiField)} ${problem}`
  }
  return errors
}

/** Parses the story points input: `null` when empty, `undefined` when invalid. */
export function parseStoryPoints(raw: string): number | null | undefined {
  const text = raw.trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : undefined
}

/** Everything the form submits. */
export interface CreateFormValues {
  projectKey: string | null
  type: IssueType
  summary: string
  description: string
  priority: Priority
  fields: ProjectScopedFields
  /** The resolved parent (its type known once loaded). */
  parent: ParentChoice | null
  /** Whether the sprint field applies (Scrum project, standard type). */
  sprintApplies: boolean
  storyPoints: string
  dueDate: string
  /**
   * The story points / due date input holds text the browser can't parse ("5e", a half-typed
   * date): it then reports an empty value, which must not pass as "not set".
   */
  storyPointsUnparsable?: boolean
  dueDateUnparsable?: boolean
}

/** Client-side validation (the server re-validates; its field errors are mapped back). */
export function validateCreateForm(values: CreateFormValues): CreateErrors {
  const errors: CreateErrors = {}
  if (!values.projectKey) errors.project = 'Select a project'
  const summary = values.summary.trim()
  if (!summary) errors.summary = 'Summary is required'
  else if (charCount(summary) > MAX_SUMMARY_LENGTH) errors.summary = `Summary can be at most ${MAX_SUMMARY_LENGTH} characters`
  const parentTypes = allowedParentTypes(values.type)
  if (values.type === 'subtask' && !values.parent) {
    errors.parent = 'A subtask needs a parent issue'
  } else if (values.parent?.type && parentTypes.length > 0 && !parentTypes.includes(values.parent.type)) {
    errors.parent = values.type === 'subtask' ? 'The parent must be a story, task or bug' : 'The parent must be an epic'
  }
  if (values.storyPointsUnparsable || parseStoryPoints(values.storyPoints) === undefined) {
    errors.storyPoints = 'Enter a number from 0 to 1000'
  }
  if (values.dueDateUnparsable || (values.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(values.dueDate))) {
    errors.dueDate = 'Enter a valid date'
  }
  return errors
}

/** Request body for `useCreateIssue` — only the fields that were set. */
export function buildCreateInput(values: CreateFormValues & { projectKey: string }): CreateIssueVariables {
  const { fields, parent } = values
  const input: CreateIssueVariables = {
    projectKey: values.projectKey,
    type: values.type,
    summary: values.summary.trim(),
    priority: values.priority,
  }
  const description = values.description.trim()
  if (description) input.description = description
  if (fields.assignee) input.assigneeId = fields.assignee.id
  if (fields.labelIds.length > 0) input.labelIds = fields.labelIds
  if (parent && values.type !== 'epic') input.parentId = parent.id
  if (values.sprintApplies && fields.sprintId != null) input.sprintId = fields.sprintId
  if (fields.statusId != null) input.statusId = fields.statusId
  const points = parseStoryPoints(values.storyPoints)
  if (points != null) input.storyPoints = points
  if (values.dueDate) input.dueDate = values.dueDate
  return input
}
