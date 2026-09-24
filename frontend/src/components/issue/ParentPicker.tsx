import type { IssueType } from '@/api/types'
import { allowedParentTypes } from '@/lib/issueMeta'
import { IssuePicker, type IssuePickerProps } from './IssuePicker'
import { PickerPlaceholder, PickerTrigger } from './PickerTrigger'

/** Props of `ParentPicker`. */
export interface ParentPickerProps extends Omit<IssuePickerProps, 'types' | 'projectKey'> {
  projectKey: string
  /** Type of the child issue: standard types pick an epic, subtasks pick a story/task/bug. */
  childType: IssueType
}

/**
 * Parent / epic picker honouring the hierarchy rules: epics for stories/tasks/bugs, standard
 * issues for subtasks (required → no "None" by default), nothing for epics.
 */
export function ParentPicker({ childType, allowNone, placeholder, noneLabel, ...props }: ParentPickerProps) {
  const types = allowedParentTypes(childType)
  const isSubtask = childType === 'subtask'
  if (types.length === 0) {
    return (
      <PickerTrigger
        variant={props.variant}
        disabled
        className={props.className}
        id={props.id}
        aria-label={props['aria-label'] ?? (props.fieldLabel ? `${props.fieldLabel}: ${placeholder ?? 'None'}` : 'No parent')}
      >
        <PickerPlaceholder>{placeholder ?? 'None'}</PickerPlaceholder>
      </PickerTrigger>
    )
  }
  return (
    <IssuePicker
      {...props}
      types={types}
      allowNone={allowNone ?? !isSubtask}
      noneLabel={noneLabel ?? (isSubtask ? 'None' : 'No epic')}
      placeholder={placeholder ?? (isSubtask ? 'Select parent issue' : props.variant === 'inline' ? 'None' : 'Select epic')}
      searchPlaceholder={isSubtask ? 'Search stories, tasks and bugs…' : 'Search epics…'}
    />
  )
}
