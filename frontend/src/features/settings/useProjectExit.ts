import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, seg } from '@/api/client'
import { forgetProject } from '@/api/invalidate'
import type { ID } from '@/api/types'

/**
 * Leaves the project's pages *before* its cache is touched: navigate to `/projects` first
 * (`replace`, so Back doesn't return to a project the user can no longer open), then forget the
 * project's cached data without refetching it (the shared {@link forgetProject}).
 */
async function exitProject(qc: QueryClient, navigate: ReturnType<typeof useNavigate>, projectKey: string) {
  await navigate('/projects', { replace: true })
  void forgetProject(qc, projectKey)
}

/** DELETE /projects/{key} (admin), then leave the project's pages. */
export function useDeleteProjectAndExit(projectKey: string) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => api.delete(`/projects/${seg(projectKey)}`),
    onSuccess: () => exitProject(qc, navigate, projectKey),
  })
}

/** DELETE /projects/{key}/members/{myId} — leave the project (409 when you're the last admin). */
export function useLeaveProject(projectKey: string, myUserId: ID) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => api.delete(`/projects/${seg(projectKey)}/members/${myUserId}`),
    onSuccess: () => exitProject(qc, navigate, projectKey),
  })
}
