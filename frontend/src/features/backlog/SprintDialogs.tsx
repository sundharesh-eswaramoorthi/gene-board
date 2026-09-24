import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useStartSprint, useUpdateSprint } from '@/api/sprints'
import type { Sprint, StartSprintInput, UpdateSprintInput } from '@/api/types'
import { Button, Dialog, Field, Input, Select, Textarea, toast, toastError } from '@/components/ui'
import { formatDateRange } from '@/lib/dates'
import { fieldErrors } from '@/lib/errors'
import { pluralize } from '@/lib/format'
import {
  DURATION_OPTIONS,
  endForDuration,
  inferDuration,
  initialSprintValues,
  validateSprint,
  type SprintDuration,
  type SprintFormErrors,
  type SprintFormValues,
} from './sprintForm'

const FORM_FIELDS = ['name', 'goal', 'startDate', 'endDate'] as const

/** Server `fields` that belong to this form (others are reported as a toast). */
function serverFieldErrors(err: unknown): SprintFormErrors {
  const fields = fieldErrors(err)
  const out: SprintFormErrors = {}
  for (const f of FORM_FIELDS) if (fields[f]) out[f] = fields[f]
  return out
}

function hasErrors(errors: SprintFormErrors): boolean {
  return Object.values(errors).some(Boolean)
}

/** Form state shared by the Start and Edit dialogs: values, live validation, server errors. */
function useSprintForm(sprint: Sprint, { startToday, requireDates }: { startToday: boolean; requireDates: boolean }) {
  const [values, setValues] = useState<SprintFormValues>(() => initialSprintValues(sprint, { startToday }))
  const [serverErrors, setServerErrors] = useState<SprintFormErrors>({})
  const [showErrors, setShowErrors] = useState(false)
  const clientErrors = validateSprint(values, { requireDates })
  const errors: SprintFormErrors = { ...(showErrors ? clientErrors : {}), ...serverErrors }

  const update = (patch: Partial<SprintFormValues>) => {
    setValues((v) => ({ ...v, ...patch }))
    setServerErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch)) delete next[k as keyof SprintFormErrors]
      if ('duration' in patch) delete next.endDate
      return next
    })
  }

  /** Reveal client errors; returns true when the form may be submitted. */
  const check = () => {
    setShowErrors(true)
    return !hasErrors(clientErrors)
  }

  /** Map a failed request to field errors, or toast it. */
  const fail = (err: unknown, fallback: string) => {
    const fields = serverFieldErrors(err)
    if (hasErrors(fields)) setServerErrors(fields)
    else toastError(err, fallback)
  }

  return { values, errors, update, check, fail }
}

interface SprintFormFieldsProps {
  values: SprintFormValues
  errors: SprintFormErrors
  onChange: (patch: Partial<SprintFormValues>) => void
  requireDates: boolean
}

/** Name, duration preset, start/end dates and goal. Presets recompute the end date. */
function SprintFormFields({ values, errors, onChange, requireDates }: SprintFormFieldsProps) {
  const setStart = (startDate: string) => {
    const endDate = endForDuration(startDate, values.duration)
    onChange(endDate ? { startDate, endDate } : { startDate })
  }
  const setDuration = (duration: SprintDuration) => {
    const endDate = endForDuration(values.startDate, duration)
    onChange(endDate ? { duration, endDate } : { duration })
  }
  const setEnd = (endDate: string) => {
    onChange({ endDate, duration: values.startDate && endDate ? inferDuration(values.startDate, endDate) : 'custom' })
  }
  const range = formatDateRange(values.startDate || null, values.endDate || null)

  return (
    <div className="flex flex-col gap-4">
      <Field label="Sprint name" required error={errors.name}>
        <Input
          data-autofocus
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          data-testid="sprint-name"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Duration">
          <Select
            options={DURATION_OPTIONS}
            value={values.duration}
            onChange={(e) => setDuration(e.target.value as SprintDuration)}
            data-testid="sprint-duration"
          />
        </Field>
        <Field label="Start date" required={requireDates} error={errors.startDate}>
          <Input
            type="date"
            value={values.startDate}
            onChange={(e) => setStart(e.target.value)}
            data-testid="sprint-start-date"
          />
        </Field>
        <Field label="End date" required={requireDates} error={errors.endDate}>
          <Input
            type="date"
            value={values.endDate}
            min={values.startDate || undefined}
            onChange={(e) => setEnd(e.target.value)}
            data-testid="sprint-end-date"
          />
        </Field>
      </div>
      {range && !errors.startDate && !errors.endDate && (
        <p className="-mt-2 text-xs text-fg-subtle" aria-live="polite">
          {range}
        </p>
      )}
      <Field label="Sprint goal" hint="Optional: what should this sprint achieve?" error={errors.goal}>
        <Textarea
          minRows={3}
          maxRows={8}
          value={values.goal}
          onChange={(e) => onChange({ goal: e.target.value })}
          data-testid="sprint-goal"
        />
      </Field>
    </div>
  )
}

/** Props of the sprint dialogs (mounted fresh for each opening). */
export interface SprintDialogProps {
  projectKey: string
  sprint: Sprint
  /** Issues currently planned in the sprint (for the description). */
  issueCount: number
  onClose: () => void
}

/**
 * Start sprint: name, goal, start date (default today), 1–4 week presets or a custom end date.
 * Sends the name and goal only when they were changed.
 */
export function StartSprintDialog({ projectKey, sprint, issueCount, onClose }: SprintDialogProps) {
  const navigate = useNavigate()
  const start = useStartSprint(projectKey)
  const form = useSprintForm(sprint, { startToday: true, requireDates: true })

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.check()) return
    const { startDate, endDate } = form.values
    const name = form.values.name.trim()
    const goal = form.values.goal.trim()
    // Name and goal only when changed here, so a teammate's rename meanwhile is kept.
    const input: StartSprintInput = { startDate, endDate }
    if (name !== sprint.name) input.name = name
    if (goal !== sprint.goal) input.goal = goal
    try {
      const started = await start.mutateAsync({ id: sprint.id, ...input })
      toast.success(`${started.name} started`, {
        action: { label: 'View board', onClick: () => navigate(`/projects/${projectKey}/board`) },
      })
      onClose()
    } catch (err) {
      form.fail(err, 'Couldn’t start the sprint')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Start sprint"
      description={`${pluralize(issueCount, 'issue')} will be included in this sprint.`}
      onSubmit={(e) => void submit(e)}
      preventClose={start.isPending}
      data-testid="start-sprint-dialog"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={start.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={start.isPending} data-testid="start-sprint-submit">
            Start
          </Button>
        </>
      }
    >
      <SprintFormFields values={form.values} errors={form.errors} onChange={form.update} requireDates />
    </Dialog>
  )
}

/** Edit sprint: sends only the fields that changed (cleared dates → null; active sprints keep dates). */
export function EditSprintDialog({ projectKey, sprint, onClose }: SprintDialogProps) {
  const update = useUpdateSprint(projectKey)
  const requireDates = sprint.state === 'active'
  const form = useSprintForm(sprint, { startToday: false, requireDates })

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.check()) return
    const name = form.values.name.trim()
    const goal = form.values.goal.trim()
    const startDate = form.values.startDate || null
    const endDate = form.values.endDate || null
    const patch: UpdateSprintInput = {}
    if (name !== sprint.name) patch.name = name
    if (goal !== sprint.goal) patch.goal = goal
    if (startDate !== sprint.startDate) patch.startDate = startDate
    if (endDate !== sprint.endDate) patch.endDate = endDate
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    try {
      await update.mutateAsync({ id: sprint.id, ...patch })
      toast.success('Sprint updated')
      onClose()
    } catch (err) {
      form.fail(err, 'Couldn’t update the sprint')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit sprint"
      description={sprint.name}
      onSubmit={(e) => void submit(e)}
      preventClose={update.isPending}
      data-testid="edit-sprint-dialog"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending} data-testid="edit-sprint-submit">
            Save
          </Button>
        </>
      }
    >
      <SprintFormFields values={form.values} errors={form.errors} onChange={form.update} requireDates={requireDates} />
    </Dialog>
  )
}
