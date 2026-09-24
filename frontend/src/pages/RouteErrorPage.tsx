import { TriangleAlert } from 'lucide-react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { NotFoundPage } from './NotFoundPage'

/**
 * Router error boundary: unexpected render errors and failed lazy chunks land here.
 * `inline` renders inside the app shell (page routes keep the top nav / sidebar).
 */
export function RouteErrorPage({ inline = false }: { inline?: boolean }) {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  if (import.meta.env.DEV) console.error(error)
  const chunkFailed = error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message)
  return (
    <div className={inline ? 'flex h-full min-h-80 items-center justify-center p-6' : 'flex min-h-dvh items-center justify-center bg-bg p-6'}>
      <EmptyState
        icon={<TriangleAlert className="text-danger" />}
        title={chunkFailed ? 'A new version is available' : 'Something went wrong'}
        description={
          chunkFailed
            ? 'Reload the page to get the latest version of Gene Board.'
            : error instanceof Error
              ? error.message
              : 'An unexpected error occurred while showing this page.'
        }
        action={
          <>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button onClick={() => window.location.assign('/')}>Go home</Button>
          </>
        }
      />
    </div>
  )
}
