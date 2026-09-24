import { toast } from '@/components/ui/toast'
import { errorMessage, fieldErrors } from '@/lib/errors'

/** Human names of the request fields the API reports in `validation_error.fields`. */
const FIELD_LABELS: Record<string, string> = {
  type: 'Type',
  summary: 'Summary',
  description: 'Description',
  statusId: 'Status',
  priority: 'Priority',
  assigneeId: 'Assignee',
  reporterId: 'Reporter',
  parentId: 'Parent',
  sprintId: 'Sprint',
  storyPoints: 'Story points',
  dueDate: 'Due date',
  labelIds: 'Labels',
  body: 'Comment',
  targetKey: 'Linked issue',
}

/** Display name of an API request field (`storyPoints` → "Story points"). */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/**
 * Toasts a failed save with the server's message; per-field validation details (if any) go in
 * the toast description, e.g. "Story points must be at most 1000".
 */
export function toastSaveError(error: unknown, fallback = 'Couldn’t save your changes'): void {
  const message = errorMessage(error, fallback)
  const details = Object.entries(fieldErrors(error))
    .map(([field, problem]) => `${fieldLabel(field)} ${problem}`)
    .filter((detail) => detail.toLowerCase() !== message.toLowerCase())
  toast.error(message, details.length > 0 ? { description: details.join(' · ') } : undefined)
}
