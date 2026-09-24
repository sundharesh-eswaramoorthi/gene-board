import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { CenteredSpinner } from '@/components/ui/Spinner'
import { TopNav } from './TopNav'

/**
 * Authenticated shell: TopNav over a full-height, scrollable `<main>`. Pages can use `h-full`
 * to build fixed-height layouts (boards) and manage their own scrolling.
 */
export function AppLayout() {
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <TopNav />
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto bg-surface focus:outline-none">
        <Suspense fallback={<CenteredSpinner className="h-full" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
