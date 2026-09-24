import { suggestProjectKey } from '@/lib/projectKey'

/** Server rule for project keys (SPEC §5, after upper-casing). */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

/** Upper-case and strip everything but letters and digits while typing a key (max 10). */
export function sanitizeKeyInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10)
}

/**
 * Key suggestion for a project name that doesn't collide with a key the caller already sees:
 * "Gene Board" → "GB", or "GB2" / "GB3"… when "GB" is taken.
 */
export function suggestUniqueKey(name: string, taken: ReadonlySet<string>): string {
  const base = suggestProjectKey(name)
  if (!base || !taken.has(base)) return base
  for (let n = 2; n < 100; n++) {
    const suffix = String(n)
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}
