import type { Page } from '@playwright/test'
import { expect, newProjectKey, test, uid } from '../../support/fixtures.ts'
import { isoDate, testIdKeys } from '../../support/ui.ts'

/** Records `POST /issues/{key}/move` requests. */
function recordMoves(page: Page): string[] {
  const moves: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/issues\/[^/]+\/move$/.test(new URL(req.url()).pathname)) moves.push(req.url())
  })
  return moves
}

test('backlog: dropping a filtered row where it was leaves its rank alone', async ({ owner, openAs }) => {
  const key = newProjectKey('NO')
  const word = `quartz${uid(4).toLowerCase()}`
  await owner.api.createProject(key, `No-op ${key}`)
  const keys: string[] = []
  for (const summary of ['First', 'Second', `Third ${word}`, 'Fourth', `Fifth ${word}`]) {
    keys.push((await owner.api.createIssue(key, { summary })).key)
  }
  const page = await openAs(owner)
  const moves = recordMoves(page)
  await page.goto(`/projects/${key}/backlog`)
  const backlog = page.getByTestId('backlog-section-backlog')
  await expect(backlog.getByTestId(`backlog-row-${keys[4]}`)).toBeVisible()

  // Only Third and Fifth match: their real neighbours are hidden.
  await page.getByTestId('backlog-search').fill(word)
  await expect.poll(() => testIdKeys(backlog, 'backlog-row-')).toEqual([keys[2], keys[4]])

  // Keyboard: pick Third up and drop it right away.
  await backlog.getByTestId(`backlog-row-${keys[2]}`).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('[aria-pressed="true"][aria-roledescription]')).toHaveCount(1)
  // Give dnd-kit a moment to measure after the pick-up, as a person would.
  await page.waitForTimeout(250)
  await page.keyboard.press('Space')
  await expect(page.locator('[aria-pressed="true"][aria-roledescription]')).toHaveCount(0)
  await page.waitForTimeout(150)

  // Pointer: wiggle Fifth and release it in place.
  const row = backlog.getByTestId(`backlog-row-${keys[4]}`)
  const box = (await row.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, { steps: 4 })
  await expect(page.locator('[aria-pressed="true"][aria-roledescription]')).toHaveCount(1)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await expect(page.locator('[aria-pressed="true"][aria-roledescription]')).toHaveCount(0)
  await page.waitForTimeout(300)

  expect(moves).toEqual([])
  expect((await owner.api.backlog(key)).backlog.map((i) => i.key)).toEqual(keys)
})

test('backlog: creating an issue under the selected epic never guesses "subtask"', async ({ owner, openAs }) => {
  const key = newProjectKey('EC')
  await owner.api.createProject(key, `Epic create ${key}`)
  const epic = await owner.api.createIssue(key, { type: 'epic', summary: 'Checkout revamp' })

  const page = await openAs(owner)
  const creates: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === `/api/projects/${key}/issues`) creates.push(req.postData() ?? '')
  })
  // A slow epic lookup: the form must not fall back to "Subtask" in the meantime.
  await page.route(`**/api/issues/${epic.key}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await route.continue()
  })
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId(`backlog-epic-filter-${epic.key}`).click()
  await page.getByTestId('backlog-create-issue').click()
  const dialog = page.getByTestId('create-issue-modal')
  await expect(dialog.getByRole('button', { name: /^Issue type: (Story|Task|Bug)$/ })).toBeVisible()
  await expect(dialog.getByText('Subtask', { exact: true })).toHaveCount(0)
  await dialog.getByTestId('create-issue-summary').fill('Pay with a saved card')
  // The backlog knows the parent is an epic: submitting at once creates a standard issue.
  await dialog.getByTestId('create-issue-summary').press('Enter')
  await expect(dialog).toBeHidden()
  expect(creates).toHaveLength(1)
  expect(JSON.parse(creates[0])).toMatchObject({ parentId: epic.id })
  expect(JSON.parse(creates[0]).type).not.toBe('subtask')

  const created = (await owner.api.get<{ items: { type: string; parent: { id: number } | null; summary: string }[] }>(
    `/issues?project=${key}&q=saved%20card`,
  )).items
  expect(created).toHaveLength(1)
  expect(created[0].type).not.toBe('subtask')
  expect(created[0].parent?.id).toBe(epic.id)
})

test('complete sprint from the backlog: stays there and points out open subtasks of done issues', async ({ owner, openAs }) => {
  const key = newProjectKey('ST')
  await owner.api.createProject(key, `Stranded ${key}`)
  const statuses = await owner.api.statuses(key)
  const done = statuses.find((s) => s.category === 'done')!
  const sprint = await owner.api.createSprint(key)
  const next = await owner.api.createSprint(key, { name: 'Following sprint' })
  const parent = await owner.api.createIssue(key, { type: 'story', summary: 'Shipped story', sprintId: sprint.id })
  const leftover = await owner.api.createIssue(key, { type: 'subtask', summary: 'Forgotten cleanup', parentId: parent.id })
  const open = await owner.api.createIssue(key, { type: 'task', summary: 'Still open', sprintId: sprint.id })
  await owner.api.patch(`/issues/${parent.key}`, { statusId: done.id })
  await owner.api.startSprint(sprint.id, isoDate(-7), isoDate(7))

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId(`backlog-complete-sprint-${sprint.id}`).click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('This sprint contains 1 completed issue and 1 open issue.')
  const stranded = dialog.getByTestId('complete-sprint-stranded')
  await expect(stranded).toContainText('1 open subtask stays in this sprint')
  await expect(stranded.getByRole('link', { name: leftover.key })).toBeVisible()

  await dialog.getByTestId('complete-sprint-submit').click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/backlog$`))
  await expect(page.getByTestId(`backlog-section-${next.id}`).getByTestId(`backlog-row-${open.key}`)).toBeVisible()
  await expect(page.getByTestId(`backlog-start-sprint-${next.id}`)).toBeVisible()
  // As the dialog said: the subtask stayed with its done parent — and its page says where.
  expect((await owner.api.issue(leftover.key)).sprint?.id).toBe(sprint.id)
  await page.goto(`/browse/${leftover.key}`)
  await expect(page.getByTestId('issue-stranded-sprint')).toContainText(sprint.name)
})

test('switching to Kanban with open sprints asks first; leftover sprints stay manageable', async ({ owner, openAs }) => {
  const key = newProjectKey('KS')
  await owner.api.createProject(key, `Switch ${key}`)
  const active = await owner.api.createSprint(key, { name: 'Running sprint' })
  const planned = await owner.api.createSprint(key, { name: 'Future sprint' })
  const task = await owner.api.createIssue(key, { summary: 'In the running sprint', sprintId: active.id })
  await owner.api.createIssue(key, { summary: 'In the future sprint', sprintId: planned.id })
  await owner.api.startSprint(active.id, isoDate(-3), isoDate(10))

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/settings?tab=details`)
  await page.getByTestId('project-type-kanban').click()
  await expect(page.getByText('Running sprint (active) and Future sprint (planned) will stay open')).toBeVisible()
  await page.getByTestId('project-details-save').click()
  const confirm = page.getByRole('alertdialog').filter({ hasText: 'Switch to Kanban with open sprints?' })
  await expect(confirm).toContainText('Running sprint (active) and Future sprint (planned)')
  await confirm.getByRole('button', { name: 'Switch to Kanban' }).click()
  await expect.poll(async () => (await owner.api.get<{ type: string }>(`/projects/${key}`)).type).toBe('kanban')

  // Kanban projects keep a Backlog link (the ranked list), which lists the leftover sprints.
  const nav = page.getByRole('navigation', { name: 'Project' })
  await nav.getByRole('link', { name: 'Backlog' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/backlog$`))
  await expect(page.getByTestId('backlog-kanban-hint')).toBeVisible()
  const leftovers = page.getByTestId('backlog-leftover-sprints')
  await expect(leftovers).toContainText('Running sprint')
  await expect(leftovers).toContainText('Future sprint')

  await leftovers.getByTestId(`leftover-delete-${planned.id}`).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete sprint' }).click()
  await expect(leftovers).not.toContainText('Future sprint')

  await leftovers.getByTestId(`leftover-complete-${active.id}`).click()
  const dialog = page.getByTestId('complete-sprint-dialog')
  await expect(dialog).toBeVisible()
  // Kanban projects can't get a new sprint.
  await expect(dialog.getByTestId('complete-sprint-target').locator('option')).toHaveText(['Backlog'])
  await dialog.getByTestId('complete-sprint-submit').click()
  await expect(dialog).toBeHidden()
  await expect(leftovers).toHaveCount(0)
  expect((await owner.api.issue(task.key)).sprint).toBeNull()
  expect((await owner.api.get<{ state: string }>(`/sprints/${active.id}`)).state).toBe('completed')
})

test('project lists link to the backlog of Kanban projects and to every project’s epics', async ({ owner, openAs }) => {
  const key = newProjectKey('KB')
  await owner.api.createProject(key, `Flow ${key}`, 'kanban')
  const page = await openAs(owner)
  await page.goto('/projects')
  await page.getByRole('button', { name: `Actions for Flow ${key}` }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText(['Board', 'Backlog', 'Epics', 'Issues', 'Activity', 'Project settings'])
  await menu.getByRole('menuitem', { name: 'Epics' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/epics$`))
})
