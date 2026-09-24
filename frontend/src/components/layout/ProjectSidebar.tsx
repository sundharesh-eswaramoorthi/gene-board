import {
  Activity,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Settings,
  SquareKanban,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Link, useMatch } from 'react-router'
import type { Project } from '@/api/types'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { useLocalStorageState } from '@/lib/hooks'
import { PROJECT_TYPE_META } from '@/lib/issueMeta'

interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
}

function navEntries(project: Project): { planning: NavEntry[]; project: NavEntry[] } {
  const base = `/projects/${project.key}`
  // Kanban projects have a backlog too: the full ranked list of work (no sprints).
  const planning: NavEntry[] = [
    { to: `${base}/board`, label: project.type === 'scrum' ? 'Board' : 'Kanban board', icon: SquareKanban },
    { to: `${base}/backlog`, label: 'Backlog', icon: Rows3 },
    { to: `${base}/epics`, label: 'Epics', icon: Zap },
    { to: `${base}/issues`, label: 'Issues', icon: List },
  ]
  return {
    planning,
    project: [
      { to: `${base}/activity`, label: 'Activity', icon: Activity },
      { to: `${base}/settings`, label: 'Project settings', icon: Settings },
    ],
  }
}

function SidebarLink({ entry, collapsed }: { entry: NavEntry; collapsed: boolean }) {
  const Icon = entry.icon
  // Resolve "active" here (not via NavLink's className function) so the link can sit inside a
  // Radix Slot (Tooltip trigger), which only merges string class names.
  const active = !!useMatch({ path: entry.to, end: false })
  const link = (
    <Link
      to={entry.to}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? entry.label : undefined}
      className={cn(
        'relative flex h-8 items-center gap-2.5 rounded-sm px-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-surface-selected text-primary before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-[3px] before:rounded-r-full before:bg-primary'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{entry.label}</span>}
    </Link>
  )
  return collapsed ? (
    <Tooltip content={entry.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

/**
 * Project navigation: project avatar/name/type, then Board, Backlog (Scrum only), Epics,
 * Issues, Activity and Project settings. Collapsible to an icon rail (remembered per browser).
 */
export function ProjectSidebar({ project }: { project: Project }) {
  const [collapsed, setCollapsed] = useLocalStorageState(
    'gb-sidebar-collapsed',
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  )
  const entries = navEntries(project)
  return (
    <aside
      aria-label={`${project.name} navigation`}
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div className={cn('flex items-center gap-2.5 px-3 pt-4 pb-3', collapsed && 'justify-center px-0')}>
        <ProjectAvatar project={project} size={collapsed ? 'lg' : 'xl'} />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg" title={project.name}>
              {project.name}
            </p>
            <p className="truncate text-xs text-fg-muted">{PROJECT_TYPE_META[project.type].label} project</p>
          </div>
        )}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-2" aria-label="Project">
        <div className="flex flex-col gap-0.5">
          {!collapsed && (
            <p className="px-2 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Planning</p>
          )}
          {entries.planning.map((e) => (
            <SidebarLink key={e.to} entry={e} collapsed={collapsed} />
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          {!collapsed && (
            <p className="px-2 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Project</p>
          )}
          {entries.project.map((e) => (
            <SidebarLink key={e.to} entry={e} collapsed={collapsed} />
          ))}
        </div>
      </nav>
      <div className={cn('flex border-t border-border p-2', collapsed ? 'justify-center' : 'justify-end')}>
        <IconButton
          size="sm"
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          tooltipSide="right"
          icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          onClick={() => setCollapsed(!collapsed)}
        />
      </div>
    </aside>
  )
}
