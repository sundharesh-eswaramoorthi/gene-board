import type { Locator } from '@playwright/test'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { dragTo, isoDate, testIdKeys } from '../../support/ui.ts'

/** The screen-reader count in a column header, e.g. "2 issues". */
const columnCount = (column: Locator) => column.locator('header .sr-only').first()

test('board: move sprint issues across columns; order and counts persist', async ({ owner, openAs }) => {
  const key = newProjectKey('BD')
  await owner.api.createProject(key, `Board ${key}`)
  const sprint = await owner.api.createSprint(key)
  const created = []
  for (const summary of ['Wire up login form', 'Add password reset', 'Write release notes']) {
    created.push(await owner.api.createIssue(key, { summary, sprintId: sprint.id, storyPoints: 3 }))
  }
  // An issue outside the sprint stays off the board.
  const outside = await owner.api.createIssue(key, { summary: 'Not in the sprint' })
  await owner.api.startSprint(sprint.id, isoDate(0), isoDate(14))
  const [a, b, c] = created.map((i) => i.key)
  const statuses = await owner.api.statuses(key)
  const byName = (name: string) => statuses.find((s) => s.name === name)!
  const todo = byName('To Do')
  const inProgress = byName('In Progress')
  const done = byName('Done')

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/board`)
  const todoCol = page.getByTestId(`board-column-${todo.id}`)
  const progressCol = page.getByTestId(`board-column-${inProgress.id}`)
  const doneCol = page.getByTestId(`board-column-${done.id}`)

  await expect(page.getByRole('heading', { name: `${key} Sprint 1` })).toBeVisible()
  await expect(todoCol.getByTestId(`issue-card-${c}`)).toBeVisible()
  expect(await testIdKeys(todoCol, 'issue-card-')).toEqual([a, b, c])
  await expect(page.getByTestId(`issue-card-${outside.key}`)).toHaveCount(0)
  await expect(columnCount(todoCol)).toHaveText('3 issues')
  await expect(columnCount(progressCol)).toHaveText('0 issues')
  await expect(columnCount(doneCol)).toHaveText('0 issues')

  // To Do → In Progress (an empty column)
  await dragTo(page, todoCol.getByTestId(`issue-card-${a}`), progressCol, {
    beforeDrop: () => expect(progressCol.getByTestId(`issue-card-${a}`)).toBeVisible(),
  })
  await expect(progressCol.getByTestId(`issue-card-${a}`)).toBeVisible()
  await expect(columnCount(todoCol)).toHaveText('2 issues')
  await expect(columnCount(progressCol)).toHaveText('1 issue')
  await expect.poll(async () => (await owner.api.issue(a)).status.name).toBe('In Progress')

  // In Progress → Done
  await dragTo(page, progressCol.getByTestId(`issue-card-${a}`), doneCol, {
    beforeDrop: () => expect(doneCol.getByTestId(`issue-card-${a}`)).toBeVisible(),
  })
  await expect(doneCol.getByTestId(`issue-card-${a}`)).toBeVisible()
  await expect(columnCount(progressCol)).toHaveText('0 issues')
  await expect(columnCount(doneCol)).toHaveText('1 issue')
  await expect.poll(async () => (await owner.api.issue(a)).status.name).toBe('Done')
  expect((await owner.api.get<{ resolvedAt: string | null }>(`/issues/${a}`)).resolvedAt).not.toBeNull()

  // To Do → Done, dropped onto the existing card: takes its slot (above it).
  await dragTo(page, todoCol.getByTestId(`issue-card-${c}`), doneCol.getByTestId(`issue-card-${a}`), {
    // (Inside a column the sortable preview uses transforms, so only the column is checked.)
    beforeDrop: () => expect(doneCol.getByTestId(`issue-card-${c}`)).toBeVisible(),
  })
  await expect.poll(() => testIdKeys(doneCol, 'issue-card-')).toEqual([c, a])
  await expect(columnCount(todoCol)).toHaveText('1 issue')
  await expect(columnCount(doneCol)).toHaveText('2 issues')
  await expect.poll(async () => (await owner.api.issue(c)).status.name).toBe('Done')

  // Everything survives a reload.
  await page.reload()
  await expect(doneCol.getByTestId(`issue-card-${a}`)).toBeVisible()
  expect(await testIdKeys(todoCol, 'issue-card-')).toEqual([b])
  expect(await testIdKeys(progressCol, 'issue-card-')).toEqual([])
  expect(await testIdKeys(doneCol, 'issue-card-')).toEqual([c, a])
  await expect(columnCount(todoCol)).toHaveText('1 issue')
  await expect(columnCount(doneCol)).toHaveText('2 issues')

  // The move is in the issue's history.
  const history = await owner.api.get<{ field: string | null; oldValue: string | null; newValue: string | null }[]>(
    `/issues/${a}/activity`,
  )
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'status', oldValue: 'To Do', newValue: 'In Progress' }),
      expect.objectContaining({ field: 'status', oldValue: 'In Progress', newValue: 'Done' }),
    ]),
  )
})

test('board: toolbar filters narrow the cards and show "x of y" counts', async ({ demo, openAs }) => {
  const board = await demo.api.board('GB')
  const page = await openAs(demo)
  await page.goto('/projects/GB/board')
  const cards = page.locator('[data-testid^="issue-card-"]')
  await expect(cards).toHaveCount(board.issues.length)

  // Text search
  const target = board.issues.find((i) => i.type !== 'subtask')!
  await page.getByRole('searchbox', { name: 'Search this board' }).fill(target.summary)
  await expect(cards).toHaveCount(1)
  await expect(page.getByTestId(`issue-card-${target.key}`)).toBeVisible()
  const column = page.getByTestId(`board-column-${target.status.id}`)
  const total = board.issues.filter((i) => i.status.id === target.status.id).length
  await expect(columnCount(column)).toHaveText(`1 of ${total} issue${total === 1 ? '' : 's'} shown`)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(cards).toHaveCount(board.issues.length)

  // Only my issues
  await page.getByRole('button', { name: 'Only my issues' }).click()
  const mine = board.issues.filter((i) => i.assignee?.id === demo.user.id)
  await expect(cards).toHaveCount(mine.length)
  for (const issue of mine) await expect(page.getByTestId(`issue-card-${issue.key}`)).toBeVisible()
  await page.getByRole('button', { name: 'Only my issues' }).click()

  // Hide subtasks
  const subtasks = board.issues.filter((i) => i.type === 'subtask')
  expect(subtasks.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Hide subtasks' }).click()
  await expect(cards).toHaveCount(board.issues.length - subtasks.length)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(cards).toHaveCount(board.issues.length)
})

test('board: a card can be moved with the keyboard', async ({ owner, openAs }) => {
  const key = newProjectKey('KB')
  await owner.api.createProject(key, `Keyboard ${key}`)
  const sprint = await owner.api.createSprint(key)
  const issue = await owner.api.createIssue(key, { summary: 'Move me with the keys', sprintId: sprint.id })
  await owner.api.startSprint(sprint.id, isoDate(0), isoDate(7))
  const [, inProgress] = await owner.api.statuses(key)

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/board`)
  const card = page.getByTestId(`issue-card-${issue.key}`)
  await card.focus()
  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  // Give dnd-kit a moment to measure the columns after the pick-up, as a person would.
  await page.waitForTimeout(250)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId(`board-column-${inProgress.id}`).getByTestId(`issue-card-${issue.key}`)).toBeVisible()
  await page.waitForTimeout(250)
  await page.keyboard.press('Space')
  await expect(card).not.toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await owner.api.issue(issue.key)).status.id).toBe(inProgress.id)
  // Enter on a resting card opens it.
  await page.getByTestId(`issue-card-${issue.key}`).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('issue-view')).toHaveAttribute('data-issue-key', issue.key)
})

test('board: a move the server rejects puts the card back and says why', async ({ owner, openAs }) => {
  const key = newProjectKey('RJ')
  await owner.api.createProject(key, `Reject ${key}`)
  const sprint = await owner.api.createSprint(key)
  const issue = await owner.api.createIssue(key, { summary: 'Stubborn card', sprintId: sprint.id })
  await owner.api.startSprint(sprint.id, isoDate(0), isoDate(7))
  const [todo, inProgress] = await owner.api.statuses(key)

  const page = await openAs(owner)
  await page.route('**/api/issues/*/move', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'conflict', message: 'Simulated conflict from the e2e test' } }),
    }),
  )
  await page.goto(`/projects/${key}/board`)
  const card = page.getByTestId(`issue-card-${issue.key}`)
  const target = page.getByTestId(`board-column-${inProgress.id}`)
  await dragTo(page, card, target, { beforeDrop: () => expect(target.getByTestId(`issue-card-${issue.key}`)).toBeVisible() })
  // The server's message is shown.
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Simulated conflict from the e2e test' })).toBeVisible()
  await expect(page.getByTestId(`board-column-${todo.id}`).getByTestId(`issue-card-${issue.key}`)).toBeVisible()
  expect((await owner.api.issue(issue.key)).status.id).toBe(todo.id)
})
