import { lazy, type ComponentType } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { GuestOnly, RequireAuth } from '@/auth/AuthProvider'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProjectLayout } from '@/components/layout/ProjectLayout'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RouteErrorPage } from '@/pages/RouteErrorPage'
import { ModalsProvider } from './ModalsProvider'

/** Error boundary for page routes: renders inside the layout so navigation stays usable. */
const pageError = <RouteErrorPage inline />

/** Code-split a named page export: `page(() => import('…'), 'BoardPage')`. */
function page<M extends Record<string, unknown>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }))
}

const DashboardPage = page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage')
const ProjectsPage = page(() => import('@/features/projects/ProjectsPage'), 'ProjectsPage')
const IssuesPage = page(() => import('@/features/search/IssuesPage'), 'IssuesPage')
const IssuePage = page(() => import('@/features/issue/IssuePage'), 'IssuePage')
const BoardPage = page(() => import('@/features/board/BoardPage'), 'BoardPage')
const BacklogPage = page(() => import('@/features/backlog/BacklogPage'), 'BacklogPage')
const EpicsPage = page(() => import('@/features/epics/EpicsPage'), 'EpicsPage')
const ProjectActivityPage = page(() => import('@/features/activity/ProjectActivityPage'), 'ProjectActivityPage')
const ProjectSettingsPage = page(() => import('@/features/settings/ProjectSettingsPage'), 'ProjectSettingsPage')

/** Development-only design-system playground at `/dev/ui` (stripped from production builds). */
const UiShowcasePage = import.meta.env.DEV ? page(() => import('@/pages/dev/UiShowcasePage'), 'UiShowcasePage') : null

/**
 * All routes (docs/FRONTEND.md §2). Authenticated routes sit under RequireAuth → ModalsProvider
 * (issue modal via `?issue=`, create-issue modal) → AppLayout (TopNav + outlet).
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: '/login',
        element: (
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        ),
      },
      {
        path: '/register',
        element: (
          <GuestOnly>
            <RegisterPage />
          </GuestOnly>
        ),
      },
      {
        element: (
          <RequireAuth>
            <ModalsProvider>
              <AppLayout />
            </ModalsProvider>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <DashboardPage />, errorElement: pageError },
          { path: 'projects', element: <ProjectsPage />, errorElement: pageError },
          { path: 'issues', element: <IssuesPage />, errorElement: pageError },
          { path: 'browse/:issueKey', element: <IssuePage />, errorElement: pageError },
          {
            path: 'projects/:projectKey',
            element: <ProjectLayout />,
            errorElement: pageError,
            children: [
              { index: true, element: <Navigate to="board" replace /> },
              { path: 'board', element: <BoardPage />, errorElement: pageError },
              { path: 'backlog', element: <BacklogPage />, errorElement: pageError },
              { path: 'epics', element: <EpicsPage />, errorElement: pageError },
              { path: 'issues', element: <IssuesPage />, errorElement: pageError },
              { path: 'activity', element: <ProjectActivityPage />, errorElement: pageError },
              { path: 'settings', element: <ProjectSettingsPage />, errorElement: pageError },
            ],
          },
          ...(UiShowcasePage ? [{ path: 'dev/ui', element: <UiShowcasePage />, errorElement: pageError }] : []),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
