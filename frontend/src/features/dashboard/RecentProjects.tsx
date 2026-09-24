import { List, Rows3, SquareKanban, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { Project } from '@/api/types'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { pluralize } from '@/lib/format'
import { PROJECT_TYPE_META } from '@/lib/issueMeta'

/** Props of {@link RecentProjects}. */
export interface RecentProjectsProps {
  projects: readonly Project[]
  /** Open issues assigned to the caller per project key (omit when unknown). */
  assignedCounts?: ReadonlyMap<string, number>
  /** Total number of projects (for the "View all" link). */
  totalProjects: number
}

/** Cards of the caller's most recently visited projects with quick links to board, backlog and issues. */
export function RecentProjects({ projects, assignedCounts, totalProjects }: RecentProjectsProps) {
  return (
    <section aria-labelledby="recent-projects-heading" data-testid="dashboard-recent-projects">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="recent-projects-heading" className="text-base font-semibold text-fg">
          Recent projects
        </h2>
        <Link to="/projects" className="text-sm font-medium text-primary hover:underline">
          View all projects{totalProjects > projects.length ? ` (${totalProjects})` : ''}
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {projects.map((project) => (
          <li key={project.key}>
            <ProjectCard project={project} assigned={assignedCounts?.get(project.key)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProjectCard({ project, assigned }: { project: Project; assigned: number | undefined }) {
  const base = `/projects/${project.key}`
  const links: { to: string; label: string; icon: LucideIcon }[] = [
    { to: `${base}/board`, label: 'Board', icon: SquareKanban },
    { to: `${base}/backlog`, label: 'Backlog', icon: Rows3 },
    { to: `${base}/issues`, label: 'Issues', icon: List },
  ]
  return (
    <article className="group relative flex h-full flex-col rounded-lg border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong">
      <div className="flex min-w-0 items-start gap-3">
        <ProjectAvatar project={project} size="xl" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg">
            {/* Stretched link: the whole card opens the board; quick links sit above it. */}
            <Link
              to={`${base}/board`}
              className="after:absolute after:inset-0 after:rounded-lg hover:underline"
              title={project.name}
            >
              {project.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-fg-muted">
            {PROJECT_TYPE_META[project.type].label} · {project.key}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-muted">
        {pluralize(project.issueCount, 'issue')}
        {assigned != null && assigned > 0 && (
          <>
            {' · '}
            <span className="font-medium text-primary">{assigned} assigned to you</span>
          </>
        )}
      </p>
      <nav aria-label={`${project.name} shortcuts`} className="relative z-10 mt-3 flex items-center gap-1 border-t border-border pt-2.5">
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </article>
  )
}

/** Loading placeholder for the project cards. */
export function RecentProjectsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading projects">
      <Skeleton className="mb-3 h-4 w-32" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
