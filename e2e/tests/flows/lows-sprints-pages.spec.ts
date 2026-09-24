import type { Page } from '@playwright/test'
import type { Session } from '../../support/api.ts'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate } from '../../support/ui.ts'

/** Opens `path` and waits until its live-update socket for project `key` is connected. */
async function openLive(page: Page, key: string, path: string) {
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes(`/api/projects/${key}/ws`))
  await page.goto(path)
  await socket
  await page.waitForTimeout(300)
}

/** A Scrum project whose teammate `mate` (role `role`) acts through the API. */
async function projectWithMate(
  owner: Session,
  newUser: (label?: string) => Promise<Session>,
  prefix: string,
  role: 'admin' | 'member',
) {
  const key = newProjectKey(prefix)
  await owner.api.createProject(key, `Sprints ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, role)
  return { key, mate }
}

test('start sprint keeps a teammate’s rename and goal made while the dialog was open', async ({ owner, newUser, openAs }) => {
  const { key, mate } = await projectWithMate(owner, newUser, 'SR', 'member')
  const sprint = await owner.api.createSprint(key, { goal: 'Old goal' })
  await owner.api.createIssue(key, { summary: 'Planned work', sprintId: sprint.id })

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId(`backlog-start-sprint-${sprint.id}`).click()
  const dialog = page.getByTestId('start-sprint-dialog')
  await expect(dialog.getByTestId('sprint-name')).toHaveValue(sprint.name)
  await expect(dialog.getByTestId('sprint-goal')).toHaveValue('Old goal')

  await mate.api.patch(`/sprints/${sprint.id}`, { name: 'Checkout revamp', goal: 'Ship the new checkout flow' })
  await dialog.getByTestId('start-sprint-submit').click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Checkout revamp started' })).toBeVisible()
  expect(await owner.api.get(`/sprints/${sprint.id}`)).toMatchObject({
    state: 'active',
    name: 'Checkout revamp',
    goal: 'Ship the new checkout flow',
  })
})

test('the backlog’s Complete sprint dialog goes away when a teammate completes the sprint', async ({ owner, newUser, openAs }) => {
  const { key, mate } = await projectWithMate(owner, newUser, 'SC', 'member')
  const sprint = await owner.api.createSprint(key)
  await owner.api.createIssue(key, { summary: 'Unfinished', sprintId: sprint.id })
  await owner.api.startSprint(sprint.id, isoDate(-7), isoDate(7))

  const page = await openAs(owner)
  await openLive(page, key, `/projects/${key}/backlog`)
  await page.getByTestId(`backlog-complete-sprint-${sprint.id}`).click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  await expect(dialog).toContainText('This sprint contains 0 completed issues and 1 open issue.')

  await mate.api.post(`/sprints/${sprint.id}/complete`, { target: 'backlog' })
  // Not "Every issue in this sprint is done", with a submit that can only fail.
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(`backlog-section-${sprint.id}`)).toHaveCount(0)
})

test('complete sprint: a target sprint deleted meanwhile falls back to what the dialog shows', async ({ owner, newUser, openAs }) => {
  const { key, mate } = await projectWithMate(owner, newUser, 'ST', 'member')
  const sprint = await owner.api.createSprint(key)
  const next = await owner.api.createSprint(key, { name: 'Next sprint' })
  const later = await owner.api.createSprint(key, { name: 'Later sprint' })
  const open = await owner.api.createIssue(key, { summary: 'Carry me over', sprintId: sprint.id })
  await owner.api.startSprint(sprint.id, isoDate(-7), isoDate(7))

  const page = await openAs(owner)
  await openLive(page, key, `/projects/${key}/board`)
  await page.getByTestId('complete-sprint-button').click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  const target = dialog.getByTestId('complete-sprint-target')
  await expect(target).toHaveValue(`sprint:${next.id}`)
  await target.selectOption({ label: 'Later sprint' })
  await expect(dialog).toContainText('Open issues and their subtasks move to Later sprint.')

  await mate.api.delete(`/sprints/${later.id}`)
  await expect(target.locator('option')).toHaveText(['Backlog', 'Next sprint', 'New sprint'])
  await expect(target).toHaveValue(`sprint:${next.id}`)
  await expect(dialog).toContainText('Open issues and their subtasks move to Next sprint.')
  await dialog.getByTestId('complete-sprint-submit').click()
  await expect(dialog).toBeHidden()
  expect((await owner.api.issue(open.key)).sprint?.id).toBe(next.id)
})

test('delete column: a target column deleted meanwhile falls back to what the dialog shows', async ({ owner, newUser, openAs }) => {
  const { key, mate } = await projectWithMate(owner, newUser, 'DC', 'admin')
  const statuses = await owner.api.statuses(key)
  const todo = statuses.find((s) => s.name === 'To Do')!
  const progress = statuses.find((s) => s.name === 'In Progress')!
  const review = statuses.find((s) => s.name === 'In Review')!
  const issue = await owner.api.createIssue(key, { summary: 'Waiting for review', statusId: review.id })

  const page = await openAs(owner)
  await openLive(page, key, `/projects/${key}/settings?tab=columns`)
  await page.getByTestId(`column-row-${review.id}`).getByRole('button', { name: 'Delete column In Review' }).click()
  const dialog = page.getByTestId('delete-column-dialog')
  await expect(dialog).toContainText('1 issue is in this column.')
  const moveTo = dialog.getByTestId('delete-column-move-to')
  await moveTo.selectOption({ label: 'To Do' })

  await mate.api.delete(`/projects/${key}/statuses/${todo.id}`)
  await expect(moveTo.locator('option')).toHaveText(['In Progress', 'Done'])
  await expect(moveTo).toHaveValue(String(progress.id))
  await dialog.getByRole('button', { name: 'Delete column' }).click()
  await expect(dialog).toBeHidden()
  expect((await owner.api.issue(issue.key)).status.id).toBe(progress.id)
})

test('a leftover sprint of a Kanban project is completed into the backlog', async ({ owner, openAs }) => {
  const key = newProjectKey('KL')
  await owner.api.createProject(key, `Leftover ${key}`)
  const done = (await owner.api.statuses(key)).find((s) => s.category === 'done')!
  const active = await owner.api.createSprint(key, { name: 'Running sprint' })
  const planned = await owner.api.createSprint(key, { name: 'Future sprint' })
  const task = await owner.api.createIssue(key, { summary: 'Still open', sprintId: active.id })
  const story = await owner.api.createIssue(key, { type: 'story', summary: 'Shipped story', sprintId: active.id })
  const subtask = await owner.api.createIssue(key, { type: 'subtask', summary: 'Forgotten cleanup', parentId: story.id })
  await owner.api.patch(`/issues/${story.key}`, { statusId: done.id })
  await owner.api.startSprint(active.id, isoDate(-3), isoDate(10))
  await owner.api.patch(`/projects/${key}`, { type: 'kanban' })

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId('backlog-leftover-sprints').getByTestId(`leftover-complete-${active.id}`).click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  // Kanban plans no sprints: the open issues go to the backlog, not into the other leftover sprint.
  const target = dialog.getByTestId('complete-sprint-target')
  await expect(target.locator('option')).toHaveText(['Backlog'])
  await expect(target).toHaveValue('backlog')
  // The Kanban board shows every issue, so the stranded subtask doesn't disappear from it.
  const stranded = dialog.getByTestId('complete-sprint-stranded')
  await expect(stranded).toContainText('1 open subtask stays in this sprint')
  await expect(stranded).toContainText('They stay on the board')
  await expect(stranded).not.toContainText('won’t appear on the board')

  await dialog.getByTestId('complete-sprint-submit').click()
  await expect(dialog).toBeHidden()
  expect((await owner.api.issue(task.key)).sprint).toBeNull()
  expect(await owner.api.get(`/sprints/${planned.id}`)).toMatchObject({ state: 'planned', issueCount: 0 })
  expect((await owner.api.issue(subtask.key)).sprint?.id).toBe(active.id)
  await page.goto(`/projects/${key}/board`)
  await expect(page.getByTestId(`issue-card-${subtask.key}`)).toBeVisible()
})

test('complete sprint from the backlog waits for the sprint’s subtasks before it can be submitted', async ({ owner, openAs }) => {
  const key = newProjectKey('SW')
  await owner.api.createProject(key, `Subtasks ${key}`)
  const done = (await owner.api.statuses(key)).find((s) => s.category === 'done')!
  const sprint = await owner.api.createSprint(key)
  const story = await owner.api.createIssue(key, { type: 'story', summary: 'Shipped story', sprintId: sprint.id })
  const subtask = await owner.api.createIssue(key, { type: 'subtask', summary: 'Forgotten cleanup', parentId: story.id })
  await owner.api.patch(`/issues/${story.key}`, { statusId: done.id })
  await owner.api.startSprint(sprint.id, isoDate(-7), isoDate(7))

  const page = await openAs(owner)
  // Hold the dialog's subtask lookup, so it opens while that is still loading.
  const held: (() => void)[] = []
  await page.route(
    (url) => url.pathname === '/api/issues' && url.searchParams.get('type') === 'subtask',
    async (route) => {
      await new Promise<void>((resolve) => held.push(resolve))
      await route.continue()
    },
  )
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId(`backlog-complete-sprint-${sprint.id}`).click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  const submit = dialog.getByTestId('complete-sprint-submit')
  await expect.poll(() => held.length).toBeGreaterThan(0)
  // Nothing to choose: the submit button still takes the focus, but can't be used yet.
  await expect(submit).toBeFocused()
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog).not.toContainText('Every issue in this sprint is done')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()

  for (const release of held.splice(0)) release()
  await expect(dialog.getByTestId('complete-sprint-stranded').getByRole('link', { name: subtask.key })).toBeVisible()
  await expect(submit).not.toHaveAttribute('aria-disabled')
  await expect(submit).toBeFocused()
  expect((await owner.api.get<{ state: string }>(`/sprints/${sprint.id}`)).state).toBe('active')
})

test('a reopened Complete sprint dialog waits for fresh subtasks, not the ones it loaded before', async ({ owner, newUser, openAs }) => {
  const { key, mate } = await projectWithMate(owner, newUser, 'SF', 'member')
  const done = (await owner.api.statuses(key)).find((s) => s.category === 'done')!
  const sprint = await owner.api.createSprint(key)
  const story = await owner.api.createIssue(key, { type: 'story', summary: 'Almost shipped', sprintId: sprint.id })
  const subtask = await owner.api.createIssue(key, { type: 'subtask', summary: 'Forgotten cleanup', parentId: story.id })
  await owner.api.startSprint(sprint.id, isoDate(-7), isoDate(7))

  const page = await openAs(owner)
  await openLive(page, key, `/projects/${key}/backlog`)
  const isSubtaskLookup = (url: URL) => url.pathname === '/api/issues' && url.searchParams.get('type') === 'subtask'
  const loaded = page.waitForResponse((response) => isSubtaskLookup(new URL(response.url())))
  await page.getByTestId(`backlog-complete-sprint-${sprint.id}`).click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  await expect(dialog).toContainText('This sprint contains 0 completed issues and 1 open issue.')
  await loaded
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  // A teammate finishes the story (its subtask stays open); the next subtask lookup is held.
  const held: (() => void)[] = []
  await page.route(isSubtaskLookup, async (route) => {
    await new Promise<void>((resolve) => held.push(resolve))
    await route.continue()
  })
  await mate.api.patch(`/issues/${story.key}`, { statusId: done.id })
  await page.getByTestId(`backlog-complete-sprint-${sprint.id}`).click()
  await expect(dialog).toContainText('This sprint contains 1 completed issue and 0 open issues.')
  await expect.poll(() => held.length).toBeGreaterThan(0)
  // The subtasks loaded before (parent still open) don't count: submit waits for fresh ones.
  const submit = dialog.getByTestId('complete-sprint-submit')
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(dialog).not.toContainText('Every issue in this sprint is done')
  await submit.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()

  for (const release of held.splice(0)) release()
  await expect(dialog.getByTestId('complete-sprint-stranded').getByRole('link', { name: subtask.key })).toBeVisible()
  await expect(submit).not.toHaveAttribute('aria-disabled')
  expect((await owner.api.get<{ state: string }>(`/sprints/${sprint.id}`)).state).toBe('active')
})

test('complete sprint from the backlog points out stranded subtasks beyond the first 200', async ({ owner, openAs }) => {
  test.slow()
  const key = newProjectKey('SL')
  await owner.api.createProject(key, `Large ${key}`)
  const done = (await owner.api.statuses(key)).find((s) => s.category === 'done')!
  const sprint = await owner.api.createSprint(key)
  // 200 open subtasks of an open story come first; the stranded one is the newest, so it comes last.
  const open = await owner.api.createIssue(key, { type: 'story', summary: 'Big open story', sprintId: sprint.id })
  for (let i = 1; i <= 200; i++) {
    await owner.api.createIssue(key, { type: 'subtask', summary: `Step ${i}`, parentId: open.id })
  }
  const shipped = await owner.api.createIssue(key, { type: 'story', summary: 'Shipped story', sprintId: sprint.id })
  const stranded = await owner.api.createIssue(key, { type: 'subtask', summary: 'Forgotten cleanup', parentId: shipped.id })
  await owner.api.patch(`/issues/${shipped.key}`, { statusId: done.id })
  await owner.api.startSprint(sprint.id, isoDate(-7), isoDate(7))

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId(`backlog-complete-sprint-${sprint.id}`).click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  await expect(dialog).toContainText('This sprint contains 1 completed issue and 1 open issue.')
  const warning = dialog.getByTestId('complete-sprint-stranded')
  await expect(warning).toContainText('1 open subtask stays in this sprint')
  await expect(warning.getByRole('link', { name: stranded.key })).toBeVisible()
})

test('a failed background refresh of the project keeps the page and its filters', async ({ owner, newUser, openAs }) => {
  const { key, mate } = await projectWithMate(owner, newUser, 'RF', 'member')
  const issue = await owner.api.createIssue(key, { summary: 'Findable work' })

  const page = await openAs(owner)
  await openLive(page, key, `/projects/${key}/backlog`)
  const search = page.getByTestId('backlog-search')
  await search.fill('Findable')
  await expect(page.getByTestId(`backlog-row-${issue.key}`)).toBeVisible()

  // The API is unreachable for the project itself while a teammate's change refreshes it.
  let failed = 0
  await page.route(
    (url) => url.pathname === `/api/projects/${key}`,
    async (route) => {
      failed++
      await route.abort('connectionrefused')
    },
  )
  await mate.api.patch(`/issues/${issue.key}`, { summary: 'Findable work, renamed' })
  // The first attempt and both retries failed.
  await expect.poll(() => failed, { timeout: 20_000 }).toBeGreaterThanOrEqual(3)
  await page.waitForTimeout(500)

  await expect(page.getByText('Couldn’t load this project')).toHaveCount(0)
  await expect(page.getByTestId('backlog-page')).toBeVisible()
  await expect(search).toHaveValue('Findable')
  await expect(page.getByTestId(`backlog-row-${issue.key}`)).toContainText('Findable work, renamed')
})

test('a deleted project leaves the Projects menu once it answers “not found”', async ({ owner, openAs }) => {
  const kept = newProjectKey('PK')
  const doomed = newProjectKey('PD')
  await owner.api.createProject(kept, `Kept ${kept}`)
  await owner.api.createProject(doomed, `Doomed ${doomed}`)

  const page = await openAs(owner)
  await page.goto(`/projects/${kept}/board`)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('menuitem', { name: `Doomed ${doomed}` })).toBeVisible()
  await page.keyboard.press('Escape')

  await owner.api.delete(`/projects/${doomed}`)
  await nav.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('menuitem', { name: `Doomed ${doomed}` }).click()
  await expect(page.getByText('Project not found')).toBeVisible()

  await nav.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('menuitem', { name: `Kept ${kept}` })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: `Doomed ${doomed}` })).toHaveCount(0)
})
