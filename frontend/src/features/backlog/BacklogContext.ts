import { createContext, use } from 'react'
import type { ID, Sprint } from '@/api/types'
import type { BacklogContainer } from './model'

/** The epic new issues are created under while the epic filter is active. */
export interface QuickCreateParent {
  id: ID
  key: string
  summary: string
}

/** Page-level state and actions shared by every backlog section. */
export interface BacklogActions {
  projectKey: string
  /** member/admin: may create, move and plan; viewers get a read-only backlog. */
  canEdit: boolean
  /** Another sprint is active (only one may be; Start sprint is disabled then). */
  hasActiveSprint: boolean
  /** Issue currently open in the issue modal (highlighted row). */
  currentIssueKey: string | null
  openIssue: (issueKey: string) => void
  startSprint: (sprint: Sprint) => void
  editSprint: (sprint: Sprint) => void
  deleteSprint: (container: BacklogContainer) => void
  completeSprint: (sprint: Sprint) => void
  createSprint: () => void
  creatingSprint: boolean
  /** Epic selected in the epic filter: quick-created issues are added to it. */
  quickCreateParent: QuickCreateParent | null
}

/** Provided by BacklogPage. */
export const BacklogActionsContext = createContext<BacklogActions | null>(null)

/** Backlog page state/actions (only inside BacklogPage). */
export function useBacklogActions(): BacklogActions {
  const ctx = use(BacklogActionsContext)
  if (!ctx) throw new Error('useBacklogActions must be used inside BacklogPage')
  return ctx
}
