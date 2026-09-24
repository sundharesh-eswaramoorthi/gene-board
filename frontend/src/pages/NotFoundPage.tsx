import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClasses } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDocumentTitle } from '@/lib/hooks'

/** Fallback for unknown routes. */
export function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={<Compass />}
        title="We couldn’t find that page"
        description="The link may be broken, or the page may have been moved or deleted."
        action={
          <>
            <Link to="/" className={buttonClasses({ variant: 'primary' })}>
              Go to Your work
            </Link>
            <Link to="/projects" className={buttonClasses({ variant: 'secondary' })}>
              View projects
            </Link>
          </>
        }
      />
    </div>
  )
}
