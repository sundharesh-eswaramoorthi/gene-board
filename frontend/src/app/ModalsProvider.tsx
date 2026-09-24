import { createContext, lazy, Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import type { IssueDetail, IssueType } from '@/api/types'
import { normalizeKey } from '@/lib/projectKey'

const IssueDetailModal = lazy(() =>
  import('@/features/issue/IssueDetailModal').then((m) => ({ default: m.IssueDetailModal })),
)
const CreateIssueModal = lazy(() =>
  import('@/features/issue/CreateIssueModal').then((m) => ({ default: m.CreateIssueModal })),
)

/** Search param holding the issue shown in the issue modal (`?issue=GB-12`). */
export const ISSUE_MODAL_PARAM = 'issue'

/** Prefill for the create-issue modal. */
export interface CreateIssueDefaults {
  projectKey?: string
  type?: IssueType
  parentId?: number
  parentKey?: string
  /**
   * Type of the parent, when the caller knows it: lets the form infer the issue type (an
   * epic's child is a story/task/bug, a standard issue's child a subtask) without waiting
   * for the parent to load.
   */
  parentType?: IssueType
  sprintId?: number | null
  statusId?: number
  summary?: string
  onCreated?: (issue: IssueDetail) => void
}

/** Issue modal controls (URL based: `?issue=GB-12`, shareable and back-button friendly). */
export interface IssueModalApi {
  openIssue(issueKey: string): void
  closeIssue(): void
  currentIssueKey: string | null
}

/** Create-issue modal controls. */
export interface CreateIssueModalApi {
  openCreateIssue(defaults?: CreateIssueDefaults): void
}

const IssueModalContext = createContext<IssueModalApi | null>(null)
const CreateIssueModalContext = createContext<CreateIssueModalApi | null>(null)

interface ModalLocationState {
  /** How many consecutive history entries were pushed by openIssue (to unwind on close). */
  issueModalDepth?: number
}

function stateDepth(state: unknown): number {
  const depth = (state as ModalLocationState | null)?.issueModalDepth
  return typeof depth === 'number' && depth > 0 ? depth : 0
}

/**
 * Hosts the issue-detail modal (driven by `?issue=`) and the create-issue modal, and provides
 * {@link useIssueModal} / {@link useCreateIssueModal}. Must render inside the router.
 */
export function ModalsProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const rawKey = searchParams.get(ISSUE_MODAL_PARAM)
  const currentIssueKey = rawKey ? normalizeKey(rawKey) : null

  // Latest location in a ref so the context functions stay referentially stable.
  const locationRef = useRef(location)
  useEffect(() => {
    locationRef.current = location
  }, [location])

  const openIssue = useCallback(
    (issueKey: string) => {
      const loc = locationRef.current
      const key = normalizeKey(issueKey)
      const params = new URLSearchParams(loc.search)
      if (params.get(ISSUE_MODAL_PARAM)?.toUpperCase() === key) return
      params.set(ISSUE_MODAL_PARAM, key)
      const prevState = (loc.state ?? {}) as Record<string, unknown>
      navigate(
        { pathname: loc.pathname, search: `?${params.toString()}`, hash: loc.hash },
        { state: { ...prevState, issueModalDepth: stateDepth(loc.state) + 1 } },
      )
    },
    [navigate],
  )

  const closeIssue = useCallback(() => {
    const loc = locationRef.current
    const params = new URLSearchParams(loc.search)
    if (!params.has(ISSUE_MODAL_PARAM)) return
    const depth = stateDepth(loc.state)
    if (depth > 0) {
      navigate(-depth)
      return
    }
    params.delete(ISSUE_MODAL_PARAM)
    const search = params.toString()
    navigate({ pathname: loc.pathname, search: search ? `?${search}` : '', hash: loc.hash }, { replace: true })
  }, [navigate])

  const [createState, setCreateState] = useState<{ open: boolean; defaults: CreateIssueDefaults; session: number }>({
    open: false,
    defaults: {},
    session: 0,
  })

  const openCreateIssue = useCallback((defaults: CreateIssueDefaults = {}) => {
    setCreateState((s) => ({ open: true, defaults, session: s.session + 1 }))
  }, [])
  const closeCreateIssue = useCallback(() => setCreateState((s) => ({ ...s, open: false })), [])

  const issueApi = useMemo<IssueModalApi>(
    () => ({ openIssue, closeIssue, currentIssueKey }),
    [openIssue, closeIssue, currentIssueKey],
  )
  const createApi = useMemo<CreateIssueModalApi>(() => ({ openCreateIssue }), [openCreateIssue])

  return (
    <IssueModalContext value={issueApi}>
      <CreateIssueModalContext value={createApi}>
        {children}
        {currentIssueKey && (
          <Suspense fallback={null}>
            <IssueDetailModal issueKey={currentIssueKey} onClose={closeIssue} />
          </Suspense>
        )}
        {createState.session > 0 && (
          <Suspense fallback={null}>
            <CreateIssueModal
              key={createState.session}
              open={createState.open}
              defaults={createState.defaults}
              onClose={closeCreateIssue}
            />
          </Suspense>
        )}
      </CreateIssueModalContext>
    </IssueModalContext>
  )
}

/**
 * `{ openIssue(key), closeIssue(), currentIssueKey }` — opens the issue modal over the current
 * page by adding `?issue=KEY` (a history entry; Back closes it).
 */
export function useIssueModal(): IssueModalApi {
  const ctx = use(IssueModalContext)
  if (!ctx) throw new Error('useIssueModal must be used within <ModalsProvider>')
  return ctx
}

/** Like {@link useIssueModal} but returns null outside the provider (for shared components). */
export function useIssueModalOptional(): IssueModalApi | null {
  return use(IssueModalContext)
}

/**
 * `{ openCreateIssue(defaults?) }` — opens the create-issue modal. Each call mounts a fresh
 * modal instance (new `key`), so form state starts from `defaults` every time.
 */
export function useCreateIssueModal(): CreateIssueModalApi {
  const ctx = use(CreateIssueModalContext)
  if (!ctx) throw new Error('useCreateIssueModal must be used within <ModalsProvider>')
  return ctx
}
