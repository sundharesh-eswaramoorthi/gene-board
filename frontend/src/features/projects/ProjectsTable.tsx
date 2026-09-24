import { Activity, Columns3, List, MoreHorizontal, Repeat, Rows3, Settings, SquareKanban, Zap } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Project, Role } from '@/api/types'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { UserAvatar } from '@/components/issue/UserAvatar'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { IconButton } from '@/components/ui/IconButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { PROJECT_TYPE_META, ROLE_META } from '@/lib/issueMeta'
import type { ProjectSort, ProjectSortColumn } from './projectSort'

/** Props of {@link ProjectsTable}. */
export interface ProjectsTableProps {
  projects: readonly Project[]
  sort: ProjectSort
  onSort: (column: ProjectSortColumn) => void
  loading?: boolean
}

const ROLE_TONES: Record<Role, BadgeTone> = { admin: 'primary', member: 'neutral', viewer: 'neutral' }

/**
 * The caller's projects: avatar + name (+ description), key, type, lead, issue count, the
 * caller's role and a menu of shortcuts. A row click opens the project's board.
 */
export function ProjectsTable({ projects, sort, onSort, loading = false }: ProjectsTableProps) {
  const navigate = useNavigate()
  const sortProps = (column: ProjectSortColumn) => ({
    sort: sort.column === column ? sort.order : null,
    onSort: () => onSort(column),
  })
  return (
    <Table className="min-w-[760px] table-fixed" data-testid="projects-table" aria-busy={loading || undefined}>
      <caption className="sr-only">Your projects</caption>
      <TableHeader>
        <TableRow>
          <TableHead {...sortProps('name')}>Name</TableHead>
          <TableHead className="w-28" {...sortProps('key')}>
            Key
          </TableHead>
          <TableHead className="w-32">Type</TableHead>
          <TableHead className="w-48" {...sortProps('lead')}>
            Lead
          </TableHead>
          <TableHead className="w-24 text-right" {...sortProps('issues')}>
            Issues
          </TableHead>
          <TableHead className="w-28">Your role</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} />)
          : projects.map((project) => (
              <TableRow
                key={project.key}
                interactive
                data-testid={`project-row-${project.key}`}
                onClick={(e: MouseEvent) => {
                  if ((e.target as HTMLElement).closest('a, button, [role="menuitem"]')) return
                  navigate(`/projects/${project.key}/board`)
                }}
              >
                <TableCell className="py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProjectAvatar project={project} size="lg" />
                    <div className="min-w-0">
                      <Link
                        to={`/projects/${project.key}/board`}
                        className="block truncate rounded-[2px] font-medium text-fg hover:text-primary hover:underline"
                      >
                        {project.name}
                      </Link>
                      {project.description && (
                        <p className="truncate text-xs text-fg-muted" title={project.description}>
                          {project.description}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-medium text-fg-muted">{project.key}</TableCell>
                <TableCell className="text-fg-muted">
                  <span className="inline-flex items-center gap-1.5">
                    {project.type === 'scrum' ? (
                      <Repeat className="size-3.5" aria-hidden />
                    ) : (
                      <Columns3 className="size-3.5" aria-hidden />
                    )}
                    {PROJECT_TYPE_META[project.type].label}
                  </span>
                </TableCell>
                <TableCell>
                  <UserAvatar user={project.lead} size="sm" showName emptyLabel="No lead" />
                </TableCell>
                <TableCell className="text-right text-fg-muted tabular-nums">{project.issueCount.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge
                    tone={ROLE_TONES[project.myRole]}
                    variant={project.myRole === 'viewer' ? 'outline' : 'subtle'}
                    shape="square"
                  >
                    {ROLE_META[project.myRole].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <ProjectActions project={project} />
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}

function ProjectActions({ project }: { project: Project }) {
  const base = `/projects/${project.key}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" label={`Actions for ${project.name}`} tooltip="More" icon={<MoreHorizontal />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<SquareKanban />} asChild>
          <Link to={`${base}/board`}>Board</Link>
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Rows3 />} asChild>
          <Link to={`${base}/backlog`}>Backlog</Link>
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Zap />} asChild>
          <Link to={`${base}/epics`}>Epics</Link>
        </DropdownMenuItem>
        <DropdownMenuItem icon={<List />} asChild>
          <Link to={`${base}/issues`}>Issues</Link>
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Activity />} asChild>
          <Link to={`${base}/activity`}>Activity</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Settings />} asChild>
          <Link to={`${base}/settings`}>Project settings</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SkeletonRow() {
  return (
    <TableRow aria-hidden>
      <TableCell className="py-2">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-10" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-16" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-3.5 w-8" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-14" />
      </TableCell>
      <TableCell />
    </TableRow>
  )
}
