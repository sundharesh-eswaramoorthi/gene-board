import { toast } from 'sonner'
import { errorMessage } from '@/lib/errors'

/**
 * Sonner's `toast` (`toast.success('Saved')`, `toast.error(...)`, `toast('Info', { action })`).
 * The `<Toaster>` is mounted in main.tsx and themed with the design tokens.
 */
export { toast }

/** Toast an error with the best available message (ApiError message, Error message, fallback). */
export function toastError(error: unknown, fallback = 'Something went wrong'): void {
  toast.error(errorMessage(error, fallback))
}
