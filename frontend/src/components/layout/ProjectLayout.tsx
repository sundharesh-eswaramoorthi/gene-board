import { FolderX } from 'lucide-react'
import { createContext, Suspense, use, useEffect } from 'react'
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router'
import { useProject } from '@/api/projects'
import type { Project } from '@/api/types'
import { buttonClasses } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { CenteredSpinner } from '@/components/ui/Spinner'
import { recordRecentProject } from '@/lib/recentProjects'
import { useProjectRealtime } from '@/realtime/useProjectRealtime'
import { ProjectSidebar } from './ProjectSidebar'

const ProjectContext = createContext<Project | null>(null)

/**
 * The project of the current `/projects/:projectKey/*` route (always loaded inside
 * ProjectLayout). Throws when used elsewhere — outside, use `useProject(key)`.
 */
export function useCurrentProject(): Project {
  const project = use(ProjectContext)
  if (!project) throw new Error('useCurrentProject must be used inside <ProjectLayout>')
  return project
}

function SidebarSkeleton() {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-4 border-r border-border bg-bg px-3 pt-4" aria-hidden>
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  )
}

/**
 * Layout for `/projects/:projectKey/*`: loads the project (404 → "not found" state),
 * subscribes to realtime updates, renders the sidebar and the page outlet.
 */
export function ProjectLayout() {
  const { projectKey: rawKey = '' } = useParams()
  const location = useLocation()
  const projectKey = rawKey.toUpperCase()
  const project = useProject(projectKey)
  const loadedKey = project.data?.key
  // Live updates while the project is readable. A refetch answering 404 (the caller was
  // removed, or the project deleted) keeps the old data but must not keep reconnecting.
  const accessLost = project.error?.status === 404
  useProjectRealtime(loadedKey && !accessLost ? projectKey : null)

  useEffect(() => {
    if (loadedKey) recordRecentProject(loadedKey)
  }, [loadedKey])

  // Canonical upper-case keys in the URL (/projects/gb/board → /projects/GB/board).
  if (rawKey !== projectKey) {
    const rest = location.pathname.slice(`/projects/${rawKey}`.length)
    return <Navigate to={`/projects/${projectKey}${rest}${location.search}${location.hash}`} replace />
  }

  if (project.isPending) {
    return (
      <div className="flex h-full">
        <SidebarSkeleton />
        <div className="min-w-0 flex-1">
          <CenteredSpinner className="h-full" />
        </div>
      </div>
    )
  }

  if (project.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        {project.error.status === 404 ? (
          <EmptyState
            icon={<FolderX />}
            title="Project not found"
            description={`There’s no project “${projectKey}”, or you don’t have access to it.`}
            action={
              <Link to="/projects" className={buttonClasses({ variant: 'primary' })}>
                View all projects
              </Link>
            }
          />
        ) : (
          <ErrorState error={project.error} title="Couldn’t load this project" onRetry={() => void project.refetch()} />
        )}
      </div>
    )
  }

  return (
    <ProjectContext value={project.data}>
      <div className="flex h-full">
        <ProjectSidebar project={project.data} />
        <div className="min-w-0 flex-1 overflow-auto">
          <Suspense fallback={<CenteredSpinner className="h-full" />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </ProjectContext>
  )
}
