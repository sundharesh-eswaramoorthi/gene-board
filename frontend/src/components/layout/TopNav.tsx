import { ChevronDown, FolderKanban, FolderPlus, Plus, Search } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { useProjects } from '@/api/projects'
import { useCreateIssueModal, useIssueModal } from '@/app/ModalsProvider'
import { ProjectAvatar } from '@/components/issue/ProjectAvatar'
import { Button } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Kbd } from '@/components/ui/Kbd'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { useHotkey } from '@/lib/hooks'
import { isIssueKey, normalizeKey } from '@/lib/projectKey'
import { useRecentProjectKeys } from '@/lib/recentProjects'
import { useCurrentProjectKey } from '@/lib/useCurrentProjectKey'
import { Logo } from './Logo'
import { UserMenu } from './UserMenu'

const navItemClasses = (active: boolean) =>
  cn(
    'relative inline-flex h-12 shrink-0 items-center text-sm font-medium transition-colors sm:px-1',
    'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t-full sm:after:inset-x-1',
    active ? 'text-primary after:bg-primary' : 'text-fg-muted hover:text-fg',
  )

function NavInner({ children }: { children: ReactNode }) {
  return <span className="flex h-8 items-center gap-1 rounded-sm px-2 hover:bg-surface-hover">{children}</span>
}

function ProjectsMenu() {
  const location = useLocation()
  const projects = useProjects()
  const recentKeys = useRecentProjectKeys()
  const active = location.pathname.startsWith('/projects')

  const list = useMemo(() => {
    const all = projects.data ?? []
    const byKey = new Map(all.map((p) => [p.key, p]))
    const recent = recentKeys.map((k) => byKey.get(k)).filter((p) => p !== undefined)
    const rest = all.filter((p) => !recentKeys.includes(p.key))
    return { recent: recent.slice(0, 5), rest: rest.slice(0, Math.max(0, 8 - Math.min(recent.length, 5))) }
  }, [projects.data, recentKeys])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={navItemClasses(active)}>
          <NavInner>
            Projects <ChevronDown className="size-4" aria-hidden />
          </NavInner>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        {projects.isLoading && (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
          </div>
        )}
        {list.recent.length > 0 && (
          <>
            <DropdownMenuLabel>Recent</DropdownMenuLabel>
            {list.recent.map((p) => (
              <DropdownMenuItem key={p.key} asChild>
                <Link to={`/projects/${p.key}`} className="gap-2">
                  <ProjectAvatar project={p} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-fg-subtle">{p.key}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {list.rest.length > 0 && (
          <>
            {list.recent.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{list.recent.length > 0 ? 'More projects' : 'Your projects'}</DropdownMenuLabel>
            {list.rest.map((p) => (
              <DropdownMenuItem key={p.key} asChild>
                <Link to={`/projects/${p.key}`} className="gap-2">
                  <ProjectAvatar project={p} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-fg-subtle">{p.key}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {projects.data && projects.data.length === 0 && (
          <p className="px-2 py-3 text-sm text-fg-muted">You’re not in any projects yet.</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<FolderKanban />} asChild>
          <Link to="/projects">View all projects</Link>
        </DropdownMenuItem>
        <DropdownMenuItem icon={<FolderPlus />} asChild>
          <Link to="/projects?create=1">Create project</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GlobalSearch() {
  const navigate = useNavigate()
  const { openIssue } = useIssueModal()
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => inputRef.current?.focus())

  // Like Jira's quick search: an exact issue key opens that issue; anything else searches.
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const query = q.trim()
    if (isIssueKey(query)) openIssue(normalizeKey(query))
    else navigate(query ? `/issues?q=${encodeURIComponent(query)}` : '/issues')
    setQ('')
    inputRef.current?.blur()
  }

  return (
    <>
      <form role="search" onSubmit={onSubmit} className="hidden w-52 md:block lg:w-64">
        <Input
          ref={inputRef}
          type="search"
          size="md"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQ('')
              inputRef.current?.blur()
            }
          }}
          placeholder="Search issues"
          aria-label="Search issues"
          leadingIcon={<Search />}
          trailing={!q ? <Kbd className="mr-0.5">/</Kbd> : undefined}
          className="[&_input]:bg-surface-sunken [&_input]:hover:bg-surface [&_input]:focus-visible:bg-surface"
        />
      </form>
      <IconButton
        className="md:hidden"
        label="Search issues"
        icon={<Search />}
        onClick={() => navigate('/issues')}
      />
    </>
  )
}

/**
 * Global top bar: logo, Your work / Projects / Issues (Projects only on phones), the Create
 * button (opens the create-issue modal for the current project; shortcut `C`), issue search
 * (`/`) and the user menu.
 */
export function TopNav() {
  const { openCreateIssue } = useCreateIssueModal()
  const projectKey = useCurrentProjectKey()
  const create = () => openCreateIssue(projectKey ? { projectKey } : {})
  useHotkey('c', create)

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-3 sm:gap-2 sm:px-4">
      <Link to="/" aria-label="Gene Board home" className="flex items-center rounded-sm sm:mr-3">
        <Logo hideWordmarkOnMobile />
      </Link>
      <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5">
        {/* Phones have room for Projects only, with tighter spacing, or the links spill over
            Create: the logo leads to Your work and the search button to Issues. */}
        <NavLink to="/" end className={({ isActive }) => cn(navItemClasses(isActive), 'hidden sm:inline-flex')}>
          <NavInner>Your work</NavInner>
        </NavLink>
        <ProjectsMenu />
        <NavLink to="/issues" className={({ isActive }) => cn(navItemClasses(isActive), 'hidden sm:inline-flex')}>
          <NavInner>Issues</NavInner>
        </NavLink>
      </nav>
      {/* Positioned, so below ~310px (large system fonts, fold covers), where Projects still
          spills out of the nav, Create is drawn over it and keeps its taps. */}
      <Button
        variant="primary"
        size="md"
        icon={<Plus />}
        onClick={create}
        data-testid="nav-create-issue"
        title="Create issue (C)"
        className="relative sm:ml-2"
      >
        Create
      </Button>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <GlobalSearch />
        <UserMenu />
      </div>
    </header>
  )
}
