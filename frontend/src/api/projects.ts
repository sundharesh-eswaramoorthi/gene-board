import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, seg } from './client'
import { forgetProject, invalidateProject } from './invalidate'
import { qk } from './queryKeys'
import { withCondition, type QueryOptions } from './queryClient'
import type { CreateProjectInput, Project, UpdateProjectInput } from './types'

/** GET /projects — projects the caller is a member of, ordered by name. */
export function useProjects(options?: QueryOptions<Project[]>) {
  return useQuery({
    queryKey: qk.projects(),
    queryFn: ({ signal }) => api.get<Project[]>('/projects', undefined, { signal }),
    ...options,
  })
}

/** GET /projects/{key}. 404 when the project doesn't exist or the caller isn't a member. */
export function useProject(key: string | null | undefined, options?: QueryOptions<Project>) {
  return useQuery({
    ...withCondition(!!key, options),
    queryKey: qk.project(key ?? ''),
    queryFn: ({ signal }) => api.get<Project>(`/projects/${seg(key!)}`, undefined, { signal }),
  })
}

/** POST /projects — `{ key, name, description?, type? }` → 201 Project (409 if key taken). */
export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<Project>('/projects', input),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(project.key), project)
      return Promise.all([
        qc.invalidateQueries({ queryKey: qk.projects() }),
        qc.invalidateQueries({ queryKey: qk.activityFeed() }),
      ])
    },
  })
}

/** PATCH /projects/{key} (admin) — `{ name?, description?, type?, leadId? }`. */
export function useUpdateProject(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => api.patch<Project>(`/projects/${seg(key)}`, input),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(key), project)
      return invalidateProject(qc, key, { projects: true })
    },
  })
}

/**
 * DELETE /projects/{key} (admin). On success the project's cache is forgotten without
 * refetching (see {@link forgetProject}); navigate away from the project's pages.
 */
export function useDeleteProject(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/projects/${seg(key)}`),
    onSuccess: () => forgetProject(qc, key),
  })
}
