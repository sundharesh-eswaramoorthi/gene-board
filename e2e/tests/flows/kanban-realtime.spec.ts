import { ALEX } from '../../support/env.ts'
import { expect, test } from '../../support/fixtures.ts'
import { dragTo, testIdKeys } from '../../support/ui.ts'

// Both tests use the seeded OPS project, so they run one after the other.
test.describe.configure({ mode: 'serial' })

test.describe('seeded Kanban project OPS', () => {
  test('board renders every column and card; dragging a card persists', async ({ demo, openAs }) => {
    const board = await demo.api.board('OPS')
    expect(board.sprint).toBeNull()
    const page = await openAs(demo)
    await page.goto('/projects/OPS/board')
    await expect(page.getByRole('heading', { name: 'OPS board' })).toBeVisible()
    await expect(page.getByText(/14 days/)).toBeVisible()
    for (const status of board.statuses) {
      await expect(page.getByTestId(`board-column-${status.id}`)).toContainText(status.name)
    }
    await expect(page.locator('[data-testid^="issue-card-"]')).toHaveCount(board.issues.length)
    for (const issue of board.issues) {
      await expect(page.getByTestId(`board-column-${issue.status.id}`).getByTestId(`issue-card-${issue.key}`)).toBeVisible()
    }

    // Drag the first To Do card to the next column.
    const [todo, next] = board.statuses
    const moving = board.issues.find((i) => i.status.id === todo.id)!
    const targetCol = page.getByTestId(`board-column-${next.id}`)
    const before = await testIdKeys(targetCol, 'issue-card-')
    await dragTo(page, page.getByTestId(`issue-card-${moving.key}`), targetCol, {
    position: before.length ? 'bottom' : 'center',
    beforeDrop: () => expect(targetCol.getByTestId(`issue-card-${moving.key}`)).toBeVisible(),
  })
    await expect(targetCol.getByTestId(`issue-card-${moving.key}`)).toBeVisible()
    await expect.poll(async () => (await demo.api.issue(moving.key)).status.id).toBe(next.id)
    await page.reload()
    await expect(targetCol.getByTestId(`issue-card-${moving.key}`)).toBeVisible()

    // Put it back so the seed stays as it was.
    await demo.api.post(`/issues/${moving.key}/move`, { statusId: todo.id })
  })

  test('realtime: a move in one browser shows up in another without reloading', async ({ demo, loginAs, openAs }) => {
    const alex = await loginAs(ALEX.email)
    const board = await demo.api.board('OPS')
    const [todo, next] = board.statuses
    const moving = board.issues.find((i) => i.status.id === todo.id && i.type !== 'subtask')!

    const demoPage = await openAs(demo)
    const alexPage = await openAs(alex)
    // Alex's socket must be subscribed before the move happens.
    const alexSocket = alexPage.waitForEvent('websocket', (ws) => ws.url().includes('/api/projects/OPS/ws'))
    await alexPage.goto('/projects/OPS/board')
    await alexSocket
    await demoPage.goto('/projects/OPS/board')
    await expect(alexPage.getByTestId(`board-column-${todo.id}`).getByTestId(`issue-card-${moving.key}`)).toBeVisible()
    await expect(demoPage.getByTestId(`issue-card-${moving.key}`)).toBeVisible()
    await alexPage.waitForTimeout(500)

    let reloaded = false
    alexPage.on('load', () => (reloaded = true))

    // Demo drags the card; Alex's board follows.
    const demoTarget = demoPage.getByTestId(`board-column-${next.id}`)
  await dragTo(demoPage, demoPage.getByTestId(`issue-card-${moving.key}`), demoTarget, {
    position: 'bottom',
    beforeDrop: () => expect(demoTarget.getByTestId(`issue-card-${moving.key}`)).toBeVisible(),
  })
    await expect(demoPage.getByTestId(`board-column-${next.id}`).getByTestId(`issue-card-${moving.key}`)).toBeVisible()
    await expect(alexPage.getByTestId(`board-column-${next.id}`).getByTestId(`issue-card-${moving.key}`)).toBeVisible({
      timeout: 10_000,
    })

    // And the other way round: Alex edits the summary through the API, Demo's card updates.
    const summary = `${moving.summary} (edited live)`
    await alex.api.patch(`/issues/${moving.key}`, { summary })
    await expect(demoPage.getByTestId(`issue-card-${moving.key}`)).toContainText(summary, { timeout: 10_000 })
    expect(reloaded).toBe(false)

    // Restore the seed.
    await demo.api.patch(`/issues/${moving.key}`, { summary: moving.summary })
    await demo.api.post(`/issues/${moving.key}/move`, { statusId: todo.id })
    await expect(alexPage.getByTestId(`board-column-${todo.id}`).getByTestId(`issue-card-${moving.key}`)).toBeVisible()
  })
})
