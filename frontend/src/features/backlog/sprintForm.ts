import { differenceInCalendarDays } from 'date-fns'
import type { Sprint } from '@/api/types'
import { addWeeksISO, toDate, todayISO } from '@/lib/dates'

/** Sprint length preset in weeks, or a custom end date. */
export type SprintDuration = '1' | '2' | '3' | '4' | 'custom'

/** Options of the Duration select. */
export const DURATION_OPTIONS: readonly { value: SprintDuration; label: string }[] = [
  { value: '1', label: '1 week' },
  { value: '2', label: '2 weeks' },
  { value: '3', label: '3 weeks' },
  { value: '4', label: '4 weeks' },
  { value: 'custom', label: 'Custom' },
]

/** Default sprint length (Jira's default is two weeks). */
export const DEFAULT_DURATION: SprintDuration = '2'

/** End date for a preset (`start + n weeks`), or null for custom / no start. */
export function endForDuration(start: string, duration: SprintDuration): string | null {
  if (duration === 'custom' || !toDate(start)) return null
  return addWeeksISO(start, Number(duration))
}

/** The preset matching an existing date range, else `custom`. */
export function inferDuration(start: string | null, end: string | null): SprintDuration {
  const s = toDate(start)
  const e = toDate(end)
  if (!s || !e) return DEFAULT_DURATION
  const days = differenceInCalendarDays(e, s)
  const preset = DURATION_OPTIONS.find((o) => o.value !== 'custom' && Number(o.value) * 7 === days)
  return preset?.value ?? 'custom'
}

/** Editable sprint fields (dates as `YYYY-MM-DD`, empty string = none). */
export interface SprintFormValues {
  name: string
  goal: string
  duration: SprintDuration
  startDate: string
  endDate: string
}

/** Field errors keyed like the API's `fields` (name, goal, startDate, endDate). */
export type SprintFormErrors = Partial<Record<'name' | 'goal' | 'startDate' | 'endDate', string>>

/**
 * Initial form values. `startToday` (Start sprint) defaults an empty start date to today and
 * fills the end date from the duration preset.
 */
export function initialSprintValues(sprint: Sprint, { startToday }: { startToday: boolean }): SprintFormValues {
  const startDate = sprint.startDate ?? (startToday ? todayISO() : '')
  const duration = sprint.startDate && sprint.endDate ? inferDuration(sprint.startDate, sprint.endDate) : DEFAULT_DURATION
  const endDate = sprint.endDate ?? (startDate ? (endForDuration(startDate, duration) ?? '') : '')
  return { name: sprint.name, goal: sprint.goal, duration, startDate, endDate }
}

/** Client-side validation mirroring the server rules (end ≥ start; dates required to start). */
export function validateSprint(values: SprintFormValues, { requireDates }: { requireDates: boolean }): SprintFormErrors {
  const errors: SprintFormErrors = {}
  if (!values.name.trim()) errors.name = 'Sprint name is required'
  const start = toDate(values.startDate)
  const end = toDate(values.endDate)
  if (values.startDate && !start) errors.startDate = 'Enter a valid date'
  if (values.endDate && !end) errors.endDate = 'Enter a valid date'
  if (requireDates) {
    if (!values.startDate) errors.startDate = 'Start date is required'
    if (!values.endDate) errors.endDate = 'End date is required'
  }
  if (start && end && end < start) errors.endDate = 'End date must be on or after the start date'
  return errors
}
