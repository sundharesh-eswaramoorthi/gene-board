import { useMemo, useState } from 'react'
import { useProjects } from '@/api/projects'
import type { ApiError } from '@/api/client'
import type { Project } from '@/api/types'
import type { CreateIssueDefaults } from '@/app/ModalsProvider'
import { normalizeKey, projectKeyOf } from '@/lib/projectKey'
import { useRecentProjectKeys } from '@/lib/recentProjects'
import { useCurrentProjectKey } from '@/lib/useCurrentProjectKey'

/** Viewers can't create issues, so their projects aren't offered. */
export function canCreateIssuesIn(project: Project): boolean {
  return project.myRole !== 'viewer'
}

/** Result of {@link useProjectChoice}. */
export interface ProjectChoice {
  /** The selected project key (explicit choice, else the best default); null when none exists. */
  projectKey: string | null
  /** The selected project once the list has loaded. */
  project: Project | undefined
  /** Projects the caller may create issues in (member/admin). */
  creatable: Project[]
  /** Select a project explicitly. */
  choose: (projectKey: string) => void
  isLoading: boolean
  /** Why the first load failed; a failed background refetch keeps the cached list usable. */
  error: ApiError | null
  retry: () => void
}

/**
 * Project of the create-issue form. Until the user picks one it defaults to, in order:
 * `defaults.projectKey`, the parent's project, the project in the URL, recently visited
 * projects, then the first project — skipping projects where the caller is only a viewer.
 */
export function useProjectChoice(defaults: CreateIssueDefaults): ProjectChoice {
  const projects = useProjects()
  const recent = useRecentProjectKeys()
  const routeKey = useCurrentProjectKey()
  const [chosenKey, setChosenKey] = useState<string | null>(null)

  const creatable = useMemo(() => (projects.data ?? []).filter(canCreateIssuesIn), [projects.data])

  const preferred = useMemo(() => {
    const candidates = [
      defaults.projectKey,
      defaults.parentKey ? projectKeyOf(defaults.parentKey) : null,
      routeKey,
      ...recent,
    ]
    return [...new Set(candidates.filter((k): k is string => !!k).map(normalizeKey))]
  }, [defaults.projectKey, defaults.parentKey, routeKey, recent])

  const projectKey = useMemo(() => {
    if (chosenKey) return chosenKey
    if (!projects.data) return preferred[0] ?? null
    return preferred.find((key) => creatable.some((p) => p.key === key)) ?? creatable[0]?.key ?? null
  }, [chosenKey, projects.data, preferred, creatable])

  const { refetch } = projects
  return {
    projectKey,
    project: projects.data?.find((p) => p.key === projectKey),
    creatable,
    choose: setChosenKey,
    isLoading: projects.isPending,
    error: projects.isLoadingError ? projects.error : null,
    retry: () => void refetch(),
  }
}
