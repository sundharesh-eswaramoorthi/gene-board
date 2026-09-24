import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** tailwind-merge taught about Gene Board's custom theme scales. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['card', 'raised', 'overlay'],
      text: ['2xs'],
    },
  },
})

/**
 * Compose class names: `clsx` conditionals + `tailwind-merge` conflict resolution, so later
 * classes win (`cn('px-2', isWide && 'px-4')`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
