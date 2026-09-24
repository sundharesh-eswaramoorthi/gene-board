import { useProject } from '@/api/projects'
import type { Role } from '@/api/types'

/** Result of useProjectRole. */
export interface ProjectRoleInfo {
  /** The caller's role, or null while loading / not a member. */
  role: Role | null
  /** member or admin: may create/edit/move issues, comment, manage sprints. */
  canEdit: boolean
  /** admin: may edit the project, members, columns and labels. */
  isAdmin: boolean
  isLoading: boolean
}

/** The caller's role in a project (from `Project.myRole`, cached with the project). */
export function useProjectRole(projectKey: string | null | undefined): ProjectRoleInfo {
  const { data, isLoading } = useProject(projectKey)
  const role = data?.myRole ?? null
  return {
    role,
    canEdit: role === 'admin' || role === 'member',
    isAdmin: role === 'admin',
    isLoading,
  }
}
