import type { CSSProperties } from 'react'
import { splitGraphemes } from './format'

/**
 * Fixed brand colour lists (identical in both themes). These are the only hex colours
 * components may use, always through the helpers below.
 */

/** Avatar backgrounds — all have ≥ 4.5:1 contrast with white initials. */
export const AVATAR_COLORS = [
  '#5B61D6',
  '#0E8175',
  '#C2461F',
  '#8448C8',
  '#2A70B8',
  '#2B7F3E',
  '#B8326F',
  '#8C5A0A',
] as const

/** Epic chip colours. */
export const EPIC_COLORS = [
  '#7C4DDB',
  '#1F6FEB',
  '#1F845A',
  '#C9372C',
  '#B65C02',
  '#0E7C86',
  '#AE2E70',
  '#5D5DD6',
] as const

/** Swatches offered when creating / recolouring labels. */
export const LABEL_COLORS = [
  '#6B778C',
  '#E5493A',
  '#E97F33',
  '#D6A20B',
  '#2D8738',
  '#0E7C86',
  '#4BADE8',
  '#3B5BDB',
  '#904EE2',
  '#C0357A',
] as const

/** Default label colour (SPEC §5). */
export const DEFAULT_LABEL_COLOR = '#6B778C'

function positiveIndex(n: number, length: number): number {
  return ((Math.trunc(n) % length) + length) % length
}

/** Small deterministic string hash (djb2) for colour picking. */
export function hashString(value: string): number {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = (h * 33) ^ value.charCodeAt(i)
  return h >>> 0
}

/** Deterministic avatar colour for a user id. */
export function avatarColor(userId: number): string {
  return AVATAR_COLORS[positiveIndex(userId, AVATAR_COLORS.length)]
}

/** Deterministic colour for any string (e.g. a project key). */
export function colorForString(value: string): string {
  return AVATAR_COLORS[positiveIndex(hashString(value), AVATAR_COLORS.length)]
}

/** Deterministic epic colour for an epic's issue id. */
export function epicColor(epicId: number): string {
  return EPIC_COLORS[positiveIndex(epicId, EPIC_COLORS.length)]
}

/**
 * Initials for an avatar: first + last word initials ("Alex Morgan" → "AM"),
 * or up to two letters of a single word ("sam" → "SA"). Whole characters, so a name starting
 * with an emoji or a character outside the BMP ("Sam 🚀" → "S🚀") never shows half of one.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return splitGraphemes(words[0]).slice(0, 2).join('').toUpperCase()
  return (splitGraphemes(words[0])[0] + splitGraphemes(words[words.length - 1])[0]).toUpperCase()
}

/**
 * Inline style for the `chip-tint` utility: `<span className="chip-tint" style={chipStyle(c)}>`.
 * The tint mixes the colour with the current theme and keeps the text's lightness in a
 * readable range, so any hex stays legible (see `chip-tint` in index.css).
 */
export function chipStyle(color: string): CSSProperties {
  return { '--chip-color': color } as CSSProperties
}

/** True for a `#RRGGBB` colour string. */
export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
}
