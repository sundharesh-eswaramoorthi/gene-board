/** `1 issue` / `3 issues` — `plural` defaults to `singular + 's'`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * The characters of `text` as a reader sees them (grapheme clusters): an emoji, a flag or a
 * letter with accents is one item, never cut in half the way UTF-16 indexing would.
 */
export function splitGraphemes(text: string): string[] {
  return Array.from(graphemes.segment(text), (s) => s.segment)
}

/** Truncate to `max` characters with an ellipsis (whole characters: an emoji is never split). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text // fast path: never more characters than UTF-16 units
  const chars = splitGraphemes(text)
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`
}

/** Absolute URL of an issue's full page (for "copy link"). */
export function issueUrl(issueKey: string): string {
  return `${window.location.origin}/browse/${issueKey.toUpperCase()}`
}

/** Percentage (0–100, rounded) of `part` in `total`; 0 when total is 0. */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}
