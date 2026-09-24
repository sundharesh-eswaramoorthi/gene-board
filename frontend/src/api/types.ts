/**
 * API resource types — docs/SPEC.md §4, verbatim — plus the request/response shapes of the
 * endpoints in §5. JSON is camelCase, ids are numbers, timestamps RFC 3339 (UTC), dates
 * `YYYY-MM-DD`; absent optional values are `null` in responses.
 */

// ---------------------------------------------------------------------------------------------
// SPEC §4 — resource shapes
// ---------------------------------------------------------------------------------------------

/** Numeric resource id. */
export type ID = number
/** Issue type; epics are top level, subtasks need a standard parent. */
export type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'subtask'
/** Issue priority, highest → lowest. */
export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest'
/** Workflow category of a status (drives lozenge colour and resolution). */
export type StatusCategory = 'todo' | 'in_progress' | 'done'
/** Per-project role. */
export type Role = 'admin' | 'member' | 'viewer'
/** Scrum (sprints + backlog) or Kanban (continuous flow). */
export type ProjectType = 'scrum' | 'kanban'
/** Sprint lifecycle: planned → active → completed. */
export type SprintState = 'planned' | 'active' | 'completed'
/** Issue link type (stored from the source issue’s perspective). */
export type LinkType = 'blocks' | 'relates' | 'duplicates' | 'clones'

/** The signed-in user (GET /auth/me). */
export interface User {
  id: ID
  email: string
  name: string
  createdAt: string
}
/** Compact user reference embedded in other resources. */
export interface UserSummary {
  id: ID
  name: string
  email: string
}

/** Login / register response. */
export interface AuthResponse {
  token: string
  user: User
}

/** A project as seen by the calling user. */
export interface Project {
  id: ID
  key: string
  name: string
  description: string
  type: ProjectType
  lead: UserSummary | null
  /** role of the calling user */
  myRole: Role
  /** total issues in project */
  issueCount: number
  createdAt: string
  updatedAt: string
}

/** Project membership. */
export interface Member {
  user: UserSummary
  role: Role
  joinedAt: string
}

/** Workflow status == board column. */
export interface Status {
  id: ID
  name: string
  category: StatusCategory
  position: number
  wipLimit: number | null
}

/** color "#RRGGBB" */
export interface Label {
  id: ID
  name: string
  color: string
}

/** Scrum sprint with point/issue roll-ups. */
export interface Sprint {
  id: ID
  projectId: ID
  name: string
  goal: string
  state: SprintState
  startDate: string | null
  endDate: string | null
  completedAt: string | null
  /** non-subtask, non-epic issues in the sprint */
  issueCount: number
  /** sum of storyPoints of those issues (null → 0) */
  pointsTotal: number
  /** same, restricted to done-category status */
  pointsDone: number
  createdAt: string
  updatedAt: string
}

/** compact reference (parents, links, children in refs) */
export interface IssueRef {
  id: ID
  key: string
  summary: string
  type: IssueType
  status: Status
  priority: Priority
}

/** The sprint reference embedded in an issue. */
export interface IssueSprintRef {
  id: ID
  name: string
  state: SprintState
}

/** Issue as returned by lists, boards and search. */
export interface Issue {
  id: ID
  key: string
  projectId: ID
  projectKey: string
  type: IssueType
  summary: string
  description: string
  status: Status
  priority: Priority
  assignee: UserSummary | null
  reporter: UserSummary | null
  parent: IssueRef | null
  sprint: IssueSprintRef | null
  /** sorted by name */
  labels: Label[]
  storyPoints: number | null
  dueDate: string | null
  rank: string
  /** direct subtasks (0 for epics/subtasks) */
  subtaskCount: number
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Direction of a link relative to the viewed issue. */
export type LinkDirection = 'outward' | 'inward'

/** A link between two issues, from the viewed issue’s perspective. */
export interface IssueLink {
  id: ID
  type: LinkType
  /** relative to the issue being viewed */
  direction: LinkDirection
  /**
   * outward: "blocks" | "relates to" | "duplicates" | "clones"
   * inward:  "is blocked by" | "relates to" | "is duplicated by" | "is cloned by"
   */
  label: string
  /** the *other* issue */
  issue: IssueRef
  createdAt: string
}

/** Full issue (GET /issues/{key}) with children and links. */
export interface IssueDetail extends Issue {
  /** epic → its stories/tasks/bugs; standard issue → its subtasks; subtask → []. Ordered by rank. */
  children: Issue[]
  /** ordered by createdAt */
  links: IssueLink[]
}

/** Issue comment (Markdown body). */
export interface Comment {
  id: ID
  issueId: ID
  author: UserSummary | null
  body: string
  createdAt: string
  updatedAt: string
  /** edited = updatedAt > createdAt */
  edited: boolean
}

/** Activity / history row (see describeActivity for rendering). */
export interface Activity {
  id: ID
  projectId: ID
  projectKey: string
  issueId: ID | null
  issueKey: string | null
  actor: UserSummary | null
  action: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

/** Epic with child-issue progress counts. */
export interface EpicProgress {
  epic: Issue
  /** counts of child issues by status category */
  total: number
  done: number
  inProgress: number
  pointsTotal: number
  pointsDone: number
}

/** Paginated list envelope. */
export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

// ---------------------------------------------------------------------------------------------
// Errors (SPEC §3)
// ---------------------------------------------------------------------------------------------

/** Error codes of the API error envelope. */
export type ApiErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal'
  /** 429 — too many sign-in attempts; the message says when to retry */
  | 'rate_limited'
  /** client-side only: the request never reached the server */
  | 'network_error'

/** Error envelope returned with every non-2xx response. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    fields?: Record<string, string>
  }
}

// ---------------------------------------------------------------------------------------------
// Activity actions / realtime events (SPEC §2, §5)
// ---------------------------------------------------------------------------------------------

/** Known `Activity.action` values. */
export type ActivityAction =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'comment.created'
  | 'link.created'
  | 'link.deleted'
  | 'sprint.created'
  | 'sprint.started'
  | 'sprint.completed'
  | 'project.created'
  | 'member.added'
  | 'member.removed'

/** `field` values of `issue.updated` activity rows. */
export type ActivityField =
  | 'summary'
  | 'description'
  | 'type'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'reporter'
  | 'parent'
  | 'sprint'
  | 'storyPoints'
  | 'dueDate'
  | 'labels'

/** Websocket event types. */
export type RealtimeEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'issue.moved'
  | 'comment.changed'
  | 'sprint.changed'
  | 'project.changed'

/** Websocket message (a cache-invalidation hint). */
export interface RealtimeEvent {
  type: RealtimeEventType
  projectKey: string
  issueKey: string | null
  actorId: ID
}

// ---------------------------------------------------------------------------------------------
// Request bodies & endpoint responses (SPEC §5)
// ---------------------------------------------------------------------------------------------

/** POST /auth/login body. */
export interface LoginInput {
  email: string
  password: string
}

/** POST /auth/register body (name 1–100, password ≥ 8). */
export interface RegisterInput {
  email: string
  name: string
  password: string
}

/** PATCH /auth/me — a password change needs both `currentPassword` and `newPassword`. */
export interface UpdateMeInput {
  name?: string
  currentPassword?: string
  newPassword?: string
}

/** GET /users query. */
export interface UsersQuery {
  query?: string
  /** default 20, max 50 */
  limit?: number
}

/** POST /projects body. */
export interface CreateProjectInput {
  /** `^[A-Z][A-Z0-9]{1,9}$` (server upper-cases first) */
  key: string
  /** 1–80 */
  name: string
  description?: string
  /** default 'scrum' */
  type?: ProjectType
}

/** PATCH /projects/{key} body. */
export interface UpdateProjectInput {
  name?: string
  description?: string
  type?: ProjectType
  /** must be a member; null clears */
  leadId?: ID | null
}

/** POST /projects/{key}/members body. */
export interface AddMemberInput {
  email: string
  role: Role
}

/** POST /projects/{key}/statuses body. */
export interface CreateStatusInput {
  /** 1–40, unique per project (case-insensitive) */
  name: string
  category: StatusCategory
  wipLimit?: number | null
}

/** PATCH /projects/{key}/statuses/{id} body. */
export interface UpdateStatusInput {
  name?: string
  category?: StatusCategory
  wipLimit?: number | null
}

/** POST /projects/{key}/labels body. */
export interface CreateLabelInput {
  /** 1–40 */
  name: string
  /** `#RRGGBB`, default `#6B778C` */
  color?: string
}

/** PATCH /projects/{key}/labels/{id} body. */
export interface UpdateLabelInput {
  name?: string
  color?: string
}

/** POST /projects/{key}/issues body. */
export interface CreateIssueInput {
  type: IssueType
  /** 1–255 */
  summary: string
  description?: string
  statusId?: ID
  /** default 'medium' */
  priority?: Priority
  /** must be a project member */
  assigneeId?: ID | null
  /** default: caller; must be a member */
  reporterId?: ID | null
  /** hierarchy rules; subtask requires it */
  parentId?: ID | null
  /** planned/active sprint of same project; forbidden for epics; must match parent for subtasks */
  sprintId?: ID | null
  storyPoints?: number | null
  dueDate?: string | null
  /** labels of the same project */
  labelIds?: ID[]
}

/**
 * PATCH /issues/{issueKey}: absent = unchanged, `null` = clear. `labelIds` replaces the set.
 * Send only the fields that changed.
 */
export interface UpdateIssueInput {
  type?: IssueType
  summary?: string
  description?: string
  statusId?: ID
  priority?: Priority
  assigneeId?: ID | null
  reporterId?: ID | null
  parentId?: ID | null
  sprintId?: ID | null
  storyPoints?: number | null
  dueDate?: string | null
  labelIds?: ID[]
}

/**
 * POST /issues/{issueKey}/move. `sprintId`: absent = unchanged, `null` = backlog.
 * `prevIssueId` / `nextIssueId` = the issues immediately above / below in the destination list.
 */
export interface MoveIssueInput {
  statusId?: ID
  sprintId?: ID | null
  prevIssueId?: ID | null
  nextIssueId?: ID | null
}

/** GET /issues sort field. */
export type IssueSort = 'rank' | 'created' | 'updated' | 'priority' | 'key' | 'dueDate' | 'summary'
/** Sort direction. */
export type SortOrder = 'asc' | 'desc'

type OneOrMany<T> = T | readonly T[]

/** GET /issues query parameters (all optional). Lists are sent comma-separated. */
export interface IssueSearchParams {
  /** project key; otherwise searches all the caller's projects */
  project?: string
  /** matches `key` exactly (case-insensitive), or summary/description ILIKE */
  q?: string
  type?: OneOrMany<IssueType>
  statusId?: OneOrMany<ID>
  statusCategory?: OneOrMany<StatusCategory>
  priority?: OneOrMany<Priority>
  /** issue has any of these labels */
  labelId?: OneOrMany<ID>
  /** ids, and/or `me`, `none` (unassigned) */
  assigneeId?: OneOrMany<ID | 'me' | 'none'>
  /** ids and/or `me` (any of them) */
  reporterId?: OneOrMany<ID | 'me'>
  /** id, `none` (backlog: no sprint) or `active` */
  sprintId?: ID | 'none' | 'active'
  /** children of that issue */
  parentId?: ID
  /** alias of parentId */
  epicId?: ID
  resolved?: boolean
  /** default `rank` */
  sort?: IssueSort
  /** default asc for rank/key/summary/dueDate/priority, desc for created/updated */
  order?: SortOrder
  /** default 50, max 200 */
  limit?: number
  offset?: number
}

/** Comment create/update body. */
export interface CommentInput {
  /** 1–10000 chars */
  body: string
}

/** POST /issues/{key}/links body. */
export interface CreateLinkInput {
  type: LinkType
  targetKey: string
}

/** POST /projects/{key}/sprints body. */
export interface CreateSprintInput {
  name?: string
  goal?: string
  startDate?: string | null
  endDate?: string | null
}

/** PATCH /sprints/{id} body. */
export interface UpdateSprintInput {
  name?: string
  goal?: string
  startDate?: string | null
  endDate?: string | null
}

/** POST /sprints/{id}/start body. */
export interface StartSprintInput {
  startDate: string
  endDate: string
  name?: string
  goal?: string
}

/** Where open issues go when a sprint completes. */
export type CompleteSprintTarget = 'backlog' | 'sprint' | 'new'

/** POST /sprints/{id}/complete body. */
export interface CompleteSprintInput {
  target: CompleteSprintTarget
  /** required when target = 'sprint' (a planned sprint of the same project) */
  sprintId?: ID
}

/** POST /sprints/{id}/complete response. */
export interface CompleteSprintResult {
  sprint: Sprint
  completedIssueCount: number
  movedIssueCount: number
  targetSprint: Sprint | null
}

/** GET /projects/{key}/board response. */
export interface BoardResponse {
  project: Project
  statuses: Status[]
  /** Scrum: the active sprint (null → no active sprint, issues empty). Kanban: null. */
  sprint: Sprint | null
  /** ordered by rank */
  issues: Issue[]
}

/** A sprint section of the backlog. */
export interface BacklogSprint {
  sprint: Sprint
  issues: Issue[]
}

/** GET /projects/{key}/backlog response. */
export interface BacklogResponse {
  /** active + planned (active first, planned by id) */
  sprints: BacklogSprint[]
  /** issues without sprint; excludes epics and subtasks; by rank */
  backlog: Issue[]
}

/** GET /health response. */
export interface HealthResponse {
  status: 'ok'
}
