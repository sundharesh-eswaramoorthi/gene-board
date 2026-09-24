/**
 * Project key of an issue key: `projectKeyOf('GB-12') === 'GB'`. Case-insensitive input,
 * always returns upper case. Returns the whole (upper-cased) input when it has no dash.
 */
export function projectKeyOf(issueKey: string): string {
  const upper = issueKey.trim().toUpperCase()
  const dash = upper.lastIndexOf('-')
  return dash > 0 ? upper.slice(0, dash) : upper
}

/** Upper-cases and trims an issue or project key for use in URLs, API calls and cache keys. */
export function normalizeKey(key: string): string {
  return key.trim().toUpperCase()
}

/** True when `value` looks like an issue key (`ABC-123`). */
export function isIssueKey(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/.test(value.trim())
}

/** Latin letters that don't decompose into a base letter plus accents, spelled in ASCII. */
const ASCII_SPELLINGS: Record<string, string> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O',
  đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', ł: 'l', Ł: 'L', þ: 'th', Þ: 'TH', ı: 'i',
}
const SPELLED_LETTERS = new RegExp(`[${Object.keys(ASCII_SPELLINGS).join('')}]`, 'g')

/**
 * Suggest a project key from a project name: upper-case initials of the words
 * ("Gene Board" → "GB"), or the first letters of a single word ("Operations" → "OPER").
 * Accented letters count as their base letter ("Müller Projekt" → "MP").
 * The result always satisfies `^[A-Z][A-Z0-9]{1,9}$` when the name has ≥ 2 usable characters.
 */
export function suggestProjectKey(name: string): string {
  const words = name
    .normalize('NFKD')
    // NFKD splits "ü" into "u" + a combining mark: drop the marks so the letter stays in its word.
    .replace(/\p{M}/gu, '')
    .replace(SPELLED_LETTERS, (letter) => ASCII_SPELLINGS[letter])
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  let key =
    words.length === 1
      ? words[0].slice(0, 4)
      : words
          .map((w) => w[0])
          .join('')
          .slice(0, 10)
  key = key.toUpperCase().replace(/^[0-9]+/, '')
  if (key.length === 1) {
    const rest = words.join('').toUpperCase().replace(/^[0-9]+/, '')
    key = rest.slice(0, Math.max(2, Math.min(4, rest.length)))
  }
  return key.slice(0, 10)
}

/** Validates a project key as the server does (after upper-casing). Returns an error or null. */
export function validateProjectKey(key: string): string | null {
  const k = key.trim().toUpperCase()
  if (!k) return 'Key is required'
  if (!/^[A-Z]/.test(k)) return 'Key must start with a letter'
  if (!/^[A-Z][A-Z0-9]*$/.test(k)) return 'Use only letters and numbers'
  if (k.length < 2) return 'Key must be at least 2 characters'
  if (k.length > 10) return 'Key must be at most 10 characters'
  return null
}
