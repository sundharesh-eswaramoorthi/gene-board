import { LABEL_COLORS } from '@/lib/colors'

/** Names of the shared label palette (`LABEL_COLORS`, in order) for screen readers and tooltips. */
const PALETTE_NAMES = ['Grey', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Sky', 'Blue', 'Purple', 'Magenta'] as const

const NAME_BY_COLOR = new Map<string, string>(
  LABEL_COLORS.length === PALETTE_NAMES.length
    ? LABEL_COLORS.map((color, i) => [color.toUpperCase(), PALETTE_NAMES[i]])
    : [],
)

/** Name of a label colour ("Red"), or its hex code when it isn't a palette colour. */
export function colorName(hex: string): string {
  return NAME_BY_COLOR.get(hex.toUpperCase()) ?? hex.toUpperCase()
}

/** Deterministic palette colour for a new label's name (until the user picks one). */
export function suggestedLabelColor(name: string): string {
  let h = 0
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return LABEL_COLORS[h % LABEL_COLORS.length]
}
