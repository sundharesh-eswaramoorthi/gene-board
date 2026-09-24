import {
  addDays,
  addWeeks,
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isThisYear,
  isToday,
  isValid,
  isYesterday,
  parseISO,
} from 'date-fns'

/** A timestamp (RFC 3339), a date-only string (`YYYY-MM-DD`) or a Date. */
export type DateInput = string | Date | null | undefined

/**
 * Parse API values. Date-only strings (`2026-09-24`) are parsed as *local* calendar dates
 * (not UTC midnight), so they never shift a day in negative-offset timezones.
 */
export function toDate(value: DateInput): Date | null {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : parseISO(value)
  return isValid(d) ? d : null
}

/** `Sep 24, 2026` (or `fallback` for empty/invalid input). */
export function formatDate(value: DateInput, fallback = '—'): string {
  const d = toDate(value)
  return d ? format(d, 'MMM d, yyyy') : fallback
}

/** Compact date: `Sep 24` this year, `Sep 24, 2025` otherwise. */
export function formatShortDate(value: DateInput, fallback = '—'): string {
  const d = toDate(value)
  if (!d) return fallback
  return isThisYear(d) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy')
}

/** `Sep 24, 2026, 10:15 AM` in the viewer's timezone. */
export function formatDateTime(value: DateInput, fallback = '—'): string {
  const d = toDate(value)
  return d ? format(d, "MMM d, yyyy, h:mm a") : fallback
}

/**
 * Human relative time: `just now`, `5 minutes ago`, `3 hours ago`, `yesterday`,
 * `4 days ago`; older than a week falls back to {@link formatShortDate}.
 */
export function formatRelative(value: DateInput, fallback = '—'): string {
  const d = toDate(value)
  if (!d) return fallback
  const seconds = (Date.now() - d.getTime()) / 1000
  if (seconds < 45 && seconds > -45) return 'just now'
  if (seconds < 0) return formatDistanceToNowStrict(d, { addSuffix: true })
  if (seconds < 60 * 60 * 24) return formatDistanceToNowStrict(d, { addSuffix: true })
  if (isYesterday(d)) return 'yesterday'
  if (seconds < 60 * 60 * 24 * 7) {
    return formatDistanceToNowStrict(d, { addSuffix: true, unit: 'day', roundingMethod: 'floor' })
  }
  return formatShortDate(d)
}

/**
 * Whole calendar days from today until `endDate` (a `YYYY-MM-DD` string or timestamp):
 * `0` = ends today, negative = overdue by that many days, `null` when no date.
 */
export function daysRemaining(endDate: DateInput): number | null {
  const d = toDate(endDate)
  return d ? differenceInCalendarDays(d, new Date()) : null
}

/** `3 days remaining` · `1 day remaining` · `Ends today` · `2 days overdue` · `''` (no date). */
export function formatDaysRemaining(endDate: DateInput): string {
  const days = daysRemaining(endDate)
  if (days == null) return ''
  if (days === 0) return 'Ends today'
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} remaining`
  const over = Math.abs(days)
  return `${over} ${over === 1 ? 'day' : 'days'} overdue`
}

/** `Sep 1 – Sep 14, 2026` style range; tolerates either end missing. */
export function formatDateRange(start: DateInput, end: DateInput): string {
  const s = toDate(start)
  const e = toDate(end)
  if (!s && !e) return ''
  if (s && !e) return `From ${formatShortDate(s)}`
  if (!s && e) return `Until ${formatShortDate(e)}`
  const sameYear = s!.getFullYear() === e!.getFullYear()
  const left = sameYear ? format(s!, 'MMM d') : format(s!, 'MMM d, yyyy')
  return `${left} – ${format(e!, 'MMM d, yyyy')}`
}

/** Format a Date as the API's date-only form `YYYY-MM-DD` (local calendar date). */
export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Today as `YYYY-MM-DD`. */
export function todayISO(): string {
  return toISODate(new Date())
}

/** Add whole weeks to a `YYYY-MM-DD` date (Scrum sprint length presets). */
export function addWeeksISO(date: string, weeks: number): string {
  const d = toDate(date) ?? new Date()
  return toISODate(addWeeks(d, weeks))
}

/** Add whole days to a `YYYY-MM-DD` date. */
export function addDaysISO(date: string, days: number): string {
  const d = toDate(date) ?? new Date()
  return toISODate(addDays(d, days))
}

/** True when a due date (`YYYY-MM-DD`) is strictly before today. */
export function isOverdue(dueDate: DateInput): boolean {
  const days = daysRemaining(dueDate)
  return days != null && days < 0
}

/**
 * Heading for grouping a timeline by day: `Today`, `Yesterday`, `Monday, Sep 21`
 * (this year) or `Sep 21, 2025`.
 */
export function formatDayHeading(value: DateInput): string {
  const d = toDate(value)
  if (!d) return ''
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return isThisYear(d) ? format(d, 'EEEE, MMM d') : format(d, 'MMM d, yyyy')
}

/** Stable local-day bucket key (`YYYY-MM-DD`) for grouping timestamps by calendar day. */
export function dayKey(value: DateInput): string {
  const d = toDate(value)
  return d ? toISODate(d) : ''
}

/** Time of day, e.g. `10:15 AM`. */
export function formatTime(value: DateInput, fallback = ''): string {
  const d = toDate(value)
  return d ? format(d, 'h:mm a') : fallback
}
