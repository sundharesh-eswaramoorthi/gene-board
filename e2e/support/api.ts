import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { API_URL, DEMO_PASSWORD } from './env.ts'

/** Minimal shapes of the API resources the tests read (docs/SPEC.md §4). */
export interface UserSummary {
  id: number
  name: string
  email: string
}
export interface Status {
  id: number
  name: string
  category: 'todo' | 'in_progress' | 'done'
  position: number
  wipLimit: number | null
}
export interface Label {
  id: number
  name: string
  color: string
}
export interface Sprint {
  id: number
  name: string
  goal: string
  state: 'planned' | 'active' | 'completed'
  startDate: string | null
  endDate: string | null
  issueCount: number
}
export interface Issue {
  id: number
  key: string
  type: 'epic' | 'story' | 'task' | 'bug' | 'subtask'
  summary: string
  description: string
  status: Status
  priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest'
  assignee: UserSummary | null
  reporter: UserSummary | null
  parent: { id: number; key: string; summary: string } | null
  sprint: { id: number; name: string; state: string } | null
  labels: Label[]
  storyPoints: number | null
  dueDate: string | null
  rank: string
}
export interface IssueDetail extends Issue {
  children: Issue[]
  links: { id: number; type: string; direction: string; label: string; issue: { key: string } }[]
}
export interface Project {
  id: number
  key: string
  name: string
  type: 'scrum' | 'kanban'
  myRole: 'admin' | 'member' | 'viewer'
}
export interface Member {
  user: UserSummary
  role: 'admin' | 'member' | 'viewer'
}
export interface Activity {
  action: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  issueKey: string | null
}

/** Thrown for non-2xx API answers, with the error envelope's message. */
export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what} → ${status}: ${body}`)
  }
}

/** Authenticated JSON client for the e2e API, used for test setup and server-side assertions. */
export class Api {
  constructor(
    private readonly ctx: APIRequestContext,
    readonly token: string,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.ctx.fetch(`${API_URL}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
      data: body === undefined ? undefined : body,
    })
    const text = await res.text()
    if (!res.ok()) throw new ApiCallError(res.status(), text, `${method} ${path}`)
    return (text ? JSON.parse(text) : undefined) as T
  }

  get<T>(path: string) {
    return this.call<T>('GET', path)
  }
  post<T>(path: string, body: unknown = {}) {
    return this.call<T>('POST', path, body)
  }
  patch<T>(path: string, body: unknown) {
    return this.call<T>('PATCH', path, body)
  }
  put<T>(path: string, body: unknown) {
    return this.call<T>('PUT', path, body)
  }
  delete(path: string) {
    return this.call<void>('DELETE', path)
  }

  issue(key: string) {
    return this.get<IssueDetail>(`/issues/${key}`)
  }
  statuses(projectKey: string) {
    return this.get<Status[]>(`/projects/${projectKey}/statuses`)
  }
  sprints(projectKey: string) {
    return this.get<Sprint[]>(`/projects/${projectKey}/sprints`)
  }
  backlog(projectKey: string) {
    return this.get<{ sprints: { sprint: Sprint; issues: Issue[] }[]; backlog: Issue[] }>(`/projects/${projectKey}/backlog`)
  }
  board(projectKey: string) {
    return this.get<{ statuses: Status[]; sprint: Sprint | null; issues: Issue[] }>(`/projects/${projectKey}/board`)
  }
  createProject(key: string, name: string, type: 'scrum' | 'kanban' = 'scrum') {
    return this.post<Project>('/projects', { key, name, type })
  }
  createIssue(projectKey: string, body: Record<string, unknown>) {
    return this.post<IssueDetail>(`/projects/${projectKey}/issues`, { type: 'task', ...body })
  }
  createSprint(projectKey: string, body: Record<string, unknown> = {}) {
    return this.post<Sprint>(`/projects/${projectKey}/sprints`, body)
  }
  startSprint(sprintId: number, startDate: string, endDate: string) {
    return this.post<Sprint>(`/sprints/${sprintId}/start`, { startDate, endDate })
  }
  addMember(projectKey: string, email: string, role: 'admin' | 'member' | 'viewer') {
    return this.post<Member>(`/projects/${projectKey}/members`, { email, role })
  }
}

/** A signed-in account: its JWT, profile and an API client acting as it. */
export interface Session {
  token: string
  user: UserSummary
  password: string
  api: Api
}

async function authenticate(
  ctx: APIRequestContext,
  path: 'login' | 'register',
  body: Record<string, string>,
): Promise<Session> {
  const res = await ctx.post(`${API_URL}/api/auth/${path}`, { data: body })
  const text = await res.text()
  if (!res.ok()) throw new ApiCallError(res.status(), text, `POST /auth/${path}`)
  const { token, user } = JSON.parse(text) as { token: string; user: UserSummary }
  return { token, user, password: body.password, api: new Api(ctx, token) }
}

/** Logs in an existing account (the seeded ones use password123). */
export function login(ctx: APIRequestContext, email: string, password = DEMO_PASSWORD) {
  return authenticate(ctx, 'login', { email, password })
}

/** Registers a brand-new account. */
export function register(ctx: APIRequestContext, name: string, email: string, password = 'e2e-password-1') {
  return authenticate(ctx, 'register', { name, email, password })
}

/** A standalone request context (for code outside the test fixtures, e.g. global setup). */
export function newRequestContext() {
  return playwrightRequest.newContext()
}
