/** `1 issue` / `3 issues` — `plural` defaults to `singular + 's'`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Truncate to `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Absolute URL of an issue's full page (for "copy link"). */
export function issueUrl(issueKey: string): string {
  return `${window.location.origin}/browse/${issueKey.toUpperCase()}`
}

/** Percentage (0–100, rounded) of `part` in `total`; 0 when total is 0. */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}
