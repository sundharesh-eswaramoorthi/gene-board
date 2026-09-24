import type { Locator, Page } from '@playwright/test'
import type { Issue, Status } from '../../support/api.ts'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate, testIdKeys } from '../../support/ui.ts'

/** Opens `path` and waits until its live-update socket for project `key` is connected. */
async function openLive(page: Page, key: string, path: string) {
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes(`/api/projects/${key}/ws`))
  await page.goto(path)
  await socket
  await page.waitForTimeout(300)
}

/** The draggable being dragged (dnd-kit marks it with aria-pressed). */
const dragging = (page: Page) => page.locator('[aria-pressed="true"][aria-roledescription]')

/** Presses the mouse on `source` and moves past dnd-kit's 5px activation distance, then holds. */
async function pickUp(page: Page, source: Locator) {
  const box = (await source.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 6, y + 6, { steps: 3 })
  await page.mouse.move(x + 12, y + 12, { steps: 3 })
  await expect(dragging(page)).toHaveCount(1)
}

/** Glides the held pointer to the centre of `target` and lets the drop target settle. */
async function glideTo(page: Page, target: Locator) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 1, { steps: 2 })
}

test('board: a column added while a card is being dragged takes the drop', async ({ owner, openAs }) => {
  const key = newProjectKey('DC')
  await owner.api.createProject(key, `Drag column ${key}`, 'kanban')
  const issue = await owner.api.createIssue(key, { summary: 'Write the release notes' })
  const page = await openAs(owner)
  // Wide enough for a fifth column without scrolling the board sideways.
  await page.setViewportSize({ width: 1800, height: 900 })
  await openLive(page, key, `/projects/${key}/board`)
  const card = page.getByTestId(`issue-card-${issue.key}`)
  await expect(card).toBeVisible()

  await pickUp(page, card)

  // Meanwhile an admin adds a column; it appears at the end of the board, after Done.
  const qa = await owner.api.post<Status>(`/projects/${key}/statuses`, { name: 'QA', category: 'in_progress' })
  const qaColumn = page.getByTestId(`board-column-${qa.id}`)
  await expect(qaColumn).toBeVisible()

  // Glide across the other columns (Done included) onto the new one, and drop the card there.
  await glideTo(page, qaColumn)
  await expect(qaColumn.getByTestId(`issue-card-${issue.key}`)).toBeAttached()
  await page.mouse.up()
  await expect(dragging(page)).toHaveCount(0)

  await expect(qaColumn.getByTestId(`issue-card-${issue.key}`)).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(issue.key)).status.name).toBe('QA')
})

test('backlog: a sprint created while a row is being dragged takes the drop', async ({ owner, openAs }) => {
  const key = newProjectKey('DS')
  await owner.api.createProject(key, `Drag sprint ${key}`)
  const issue = await owner.api.createIssue(key, { summary: 'Plan the launch' })
  const page = await openAs(owner)
  await openLive(page, key, `/projects/${key}/backlog`)
  const row = page.getByTestId(`backlog-row-${issue.key}`)
  await expect(row).toBeVisible()
  await pickUp(page, row)

  // Meanwhile a teammate creates a sprint; its (empty) section appears above the Backlog.
  const sprint = await owner.api.createSprint(key)
  const section = page.getByTestId(`backlog-section-${sprint.id}`)
  await expect(section).toBeVisible()

  await glideTo(page, section)
  await expect.poll(() => testIdKeys(section, 'backlog-row-')).toEqual([issue.key])
  await page.mouse.up()
  await expect(dragging(page)).toHaveCount(0)

  await expect(section.getByTestId(`backlog-row-${issue.key}`)).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(issue.key)).sprint?.id).toBe(sprint.id)
})

test('board: a filter on an epic or assignee that left the board stops narrowing it', async ({ owner, openAs }) => {
  const key = newProjectKey('BF')
  await owner.api.createProject(key, `Board filters ${key}`, 'kanban')
  const epic = await owner.api.createIssue(key, { type: 'epic', summary: 'Epic Zeta' })
  await owner.api.createIssue(key, { type: 'story', summary: 'Zeta story', parentId: epic.id, assigneeId: owner.user.id })
  const loose = await owner.api.createIssue(key, { summary: 'Loose task' })
  const page = await openAs(owner)
  await openLive(page, key, `/projects/${key}/board`)
  const cards = page.locator('[data-testid^="issue-card-"]')
  const toolbar = page.getByRole('toolbar', { name: 'Board filters' })
  const clearFilters = toolbar.getByRole('button', { name: 'Clear filters' })
  await expect(cards).toHaveCount(2)

  // Epic filter: only the epic's story.
  await toolbar.getByRole('button', { name: 'Epic', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: /Epic Zeta/ }).click()
  await page.keyboard.press('Escape')
  await expect(cards).toHaveCount(1)
  await expect(toolbar.getByRole('button', { name: 'Epic, 1 selected' })).toBeVisible()

  // Someone deletes the epic: its story stays without an epic, and the hidden selection lets go.
  await owner.api.delete(`/issues/${epic.key}`)
  await expect(cards).toHaveCount(2)
  await expect(toolbar.getByRole('button', { name: 'Epic', exact: true })).toBeVisible()
  await expect(page.getByText('No issues match your filters.')).toHaveCount(0)
  await expect(clearFilters).toHaveCount(0)

  // "Unassigned": only the loose task, until it gets an assignee and the avatar goes away.
  await toolbar.getByRole('button', { name: 'Unassigned', exact: true }).click()
  await expect(cards).toHaveCount(1)
  await expect(clearFilters).toBeVisible()
  await owner.api.patch(`/issues/${loose.key}`, { assigneeId: owner.user.id })
  await expect(toolbar.getByRole('button', { name: 'Unassigned', exact: true })).toHaveCount(0)
  await expect(cards).toHaveCount(2)
  await expect(clearFilters).toHaveCount(0)
})

test('board: a subtask whose parent is off a Kanban board keeps its epic', async ({ owner, openAs }) => {
  const key = newProjectKey('HP')
  await owner.api.createProject(key, `Hidden parent ${key}`, 'kanban')
  const epic = await owner.api.createIssue(key, { type: 'epic', summary: 'Wallet' })
  const story = await owner.api.createIssue(key, { type: 'story', summary: 'Card refunds', parentId: epic.id })
  const subtask = await owner.api.createIssue(key, { type: 'subtask', summary: 'Refund follow-up', parentId: story.id })
  await owner.api.createIssue(key, { summary: 'Unrelated task' })
  const page = await openAs(owner)
  // The board as the server sends it once the story was resolved more than 14 days ago: the story
  // is off the board and only listed in `parents`. (Backdating a resolution needs the database.)
  await page.route(`**/api/projects/${key}/board`, async (route) => {
    const response = await route.fetch()
    const board = (await response.json()) as { issues: Issue[]; parents?: Issue[] }
    await route.fulfill({
      response,
      json: {
        ...board,
        issues: board.issues.filter((i) => i.key !== story.key),
        parents: [...(board.parents ?? []), ...board.issues.filter((i) => i.key === story.key)],
      },
    })
  })
  await page.goto(`/projects/${key}/board`)
  const card = page.getByTestId(`issue-card-${subtask.key}`)
  await expect(card).toHaveAttribute('aria-label', /, epic Wallet/)
  await expect(page.getByTestId(`issue-card-${story.key}`)).toHaveCount(0)

  // The epic filter files the subtask under its epic, not under "Issues without epic".
  const toolbar = page.getByRole('toolbar', { name: 'Board filters' })
  await toolbar.getByRole('button', { name: 'Epic', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: /Wallet/ }).click()
  await page.keyboard.press('Escape')
  await expect.poll(() => testIdKeys(page.locator('main'), 'issue-card-')).toEqual([subtask.key])
})

test('backlog: keyboard moves go down into empty sections', async ({ owner, openAs }) => {
  const key = newProjectKey('KD')
  await owner.api.createProject(key, `Keyboard down ${key}`)
  const active = await owner.api.createSprint(key)
  const planned = await owner.api.createSprint(key)
  const first = await owner.api.createIssue(key, { summary: 'Stays in the sprint', sprintId: active.id })
  const moved = await owner.api.createIssue(key, { summary: 'Moves down', sprintId: active.id })
  await owner.api.startSprint(active.id, isoDate(0), isoDate(14))
  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  const activeSection = page.getByTestId(`backlog-section-${active.id}`)
  const plannedSection = page.getByTestId(`backlog-section-${planned.id}`)
  const backlog = page.getByTestId('backlog-section-backlog')
  await expect(activeSection.getByTestId(`backlog-row-${moved.key}`)).toBeVisible()

  // The last row of the sprint: ↓ enters the empty planned sprint, ↓ again the empty Backlog.
  await page.getByTestId(`backlog-row-${moved.key}`).focus()
  await page.keyboard.press('Space')
  await expect(dragging(page)).toHaveCount(1)
  // Give dnd-kit a moment to measure after the pick-up, as a person would.
  await page.waitForTimeout(250)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => testIdKeys(plannedSection, 'backlog-row-')).toEqual([moved.key])
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => testIdKeys(backlog, 'backlog-row-')).toEqual([moved.key])
  await page.waitForTimeout(150)
  await page.keyboard.press('Space')
  await expect(dragging(page)).toHaveCount(0)

  await expect(backlog.getByTestId(`backlog-row-${moved.key}`)).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(moved.key)).sprint).toBeNull()
  expect((await owner.api.issue(first.key)).sprint?.id).toBe(active.id)
})

test('backlog and epics rows: the key link and epic chip sit beside the row control', async ({ owner, openAs }) => {
  const key = newProjectKey('NI')
  await owner.api.createProject(key, `Nested ${key}`)
  const epic = await owner.api.createIssue(key, { type: 'epic', summary: 'Checkout revamp' })
  const story = await owner.api.createIssue(key, { type: 'story', summary: 'Pay with a saved card', parentId: epic.id })
  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)

  // The row's control (a button) holds nothing focusable; the key link and epic chip are its siblings.
  const control = page.getByTestId(`backlog-row-${story.key}`)
  await expect(control).toHaveAttribute('role', 'button')
  expect(await control.evaluate((el) => el.querySelectorAll('a, button, input, [tabindex]').length)).toBe(0)
  const row = control.locator('..')
  await expect(row.getByRole('link', { name: story.key, exact: true })).toBeVisible()
  const chip = row.getByRole('button', { name: epic.summary, exact: true })
  await expect(chip).toBeVisible()

  // Tab goes from the key link to the control. Picked up from there, the row (now a placeholder
  // whose content is transparent) keeps the control's focus ring.
  await row.getByRole('link', { name: story.key, exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(control).toBeFocused()
  await page.keyboard.press('Space')
  await expect(dragging(page)).toHaveCount(1)
  await expect(row).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Escape')
  await expect(dragging(page)).toHaveCount(0)

  // Space on the epic chip opens the epic instead of picking the row up.
  await chip.focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('issue-view')).toHaveAttribute('data-issue-key', epic.key)
  await expect(dragging(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // Epics page: a child row is a single link (key and summary), no button around it.
  await page.goto(`/projects/${key}/epics`)
  await page.getByTestId(`epic-row-${epic.key}`).getByRole('button', { name: `Expand ${epic.key}` }).click()
  const children = page.getByRole('list', { name: `Child issues of ${epic.key}` })
  const link = children.getByRole('link', { name: new RegExp(story.summary) })
  await expect(link).toBeVisible()
  await expect(children.getByRole('button')).toHaveCount(0)
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('issue-view')).toHaveAttribute('data-issue-key', story.key)
})
