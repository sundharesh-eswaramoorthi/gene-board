import type { Page, WebSocketRoute } from '@playwright/test'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { pickOption } from '../../support/ui.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Stands in for the project's websocket, so the test decides when it closes: the first socket
 * opens (no server behind it); every later one is refused the way the API refuses a revoked
 * token, which a browser sees as a close without an open.
 */
async function fakeProjectSockets(page: Page, key: string): Promise<WebSocketRoute[]> {
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket(new RegExp(`/api/projects/${key}/ws`), async (ws) => {
    sockets.push(ws)
    if (sockets.length > 1) await ws.close({ code: 1006 })
  })
  return sockets
}

test('realtime: a busy project still refreshes a board whose download is slow', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('RB')
  await owner.api.createProject(key, `Busy ${key}`, 'kanban')
  const mate = await newUser('Remote')
  await owner.api.addMember(key, mate.user.email, 'member')
  const [todo, inProgress, , done] = await owner.api.statuses(key)
  const watched = await owner.api.createIssue(key, { summary: 'Finished by a teammate' })
  const churn = await owner.api.createIssue(key, { summary: 'Moved back and forth' })

  // A slow link: the board answer reflects the moment it was requested but takes 1.5 s to
  // arrive, longer than the gaps between the teammate's changes below.
  const page = await openAs(mate)
  await page.route(`**/api/projects/${key}/board`, async (route) => {
    const response = await route.fetch()
    await sleep(1500)
    await route.fulfill({ response }).catch(() => undefined) // the page may have given up on it
  })
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes(`/api/projects/${key}/ws`))
  await page.goto(`/projects/${key}/board`)
  await socket
  await expect(page.getByTestId(`board-column-${todo.id}`).getByTestId(`issue-card-${watched.key}`)).toBeVisible()
  await page.waitForTimeout(300)

  // The teammate finishes one issue, then keeps changing another every 400 ms for 12 s. Each
  // change used to cancel the running board download and start a new one, so none finished
  // until the teammate stopped.
  await owner.api.post(`/issues/${watched.key}/move`, { statusId: done.id })
  let busy = true
  let stop = false
  const activity = (async () => {
    const until = Date.now() + 12_000
    for (let i = 0; !stop && Date.now() < until; i++) {
      await owner.api.post(`/issues/${churn.key}/move`, { statusId: i % 2 ? todo.id : inProgress.id })
      await sleep(400)
    }
    busy = false
  })()
  try {
    await expect(page.getByTestId(`board-column-${done.id}`).getByTestId(`issue-card-${watched.key}`)).toBeVisible({
      timeout: 8_000,
    })
    expect(busy, 'the board caught up while the teammate was still at work').toBe(true)
  } finally {
    stop = true
    await activity
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test.describe('realtime: a board whose session ended elsewhere signs out', () => {
  test('when the server closes its socket (1008)', async ({ owner, newUser, openAs }) => {
    const key = newProjectKey('RS')
    await owner.api.createProject(key, `Session ${key}`, 'kanban')
    const mate = await newUser('Wall')
    await owner.api.addMember(key, mate.user.email, 'member')

    const page = await openAs(mate)
    const sockets = await fakeProjectSockets(page, key)
    await page.goto(`/projects/${key}/board`)
    await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible()
    await expect.poll(() => sockets.length).toBe(1)

    // The password changes on another device, which revokes this browser's token; at its next
    // check the server closes the socket. Reconnecting cannot help, and nothing else on the
    // idle board makes a request: it used to stop updating without a word.
    await mate.api.patch('/auth/me', { currentPassword: mate.password, newPassword: 'changed-elsewhere-2' })
    await sockets[0].close({ code: 1008, reason: 'token expired or revoked' })
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 10_000 })
    await expect(page.getByText('Your session has expired. Log in again to continue.')).toBeVisible()
  })

  test('when its reconnect is refused', async ({ owner, newUser, openAs }) => {
    const key = newProjectKey('RR')
    await owner.api.createProject(key, `Session ${key}`, 'kanban')
    const mate = await newUser('Wall')
    await owner.api.addMember(key, mate.user.email, 'member')

    const page = await openAs(mate)
    const sockets = await fakeProjectSockets(page, key)
    await page.goto(`/projects/${key}/board`)
    await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible()
    await expect.poll(() => sockets.length).toBe(1)

    // The session ends while the socket is down (the API restarting, a laptop asleep): the
    // reconnect is refused before it opens.
    await mate.api.patch('/auth/me', { currentPassword: mate.password, newPassword: 'changed-elsewhere-2' })
    await sockets[0].close({ code: 1001, reason: 'going away' })
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 10_000 })
    expect(sockets.length).toBeGreaterThan(1)
  })
})

test('linked issues: a change or deletion made from another project’s issue shows at once', async ({ owner, openAs }) => {
  const upstreamKey = newProjectKey('LU')
  const downstreamKey = newProjectKey('LD')
  await owner.api.createProject(upstreamKey, `Upstream ${upstreamKey}`, 'kanban')
  await owner.api.createProject(downstreamKey, `Downstream ${downstreamKey}`, 'kanban')
  const target = await owner.api.createIssue(upstreamKey, { summary: 'Upstream fix' })
  const source = await owner.api.createIssue(downstreamKey, { summary: 'Waits for the fix' })
  await owner.api.post(`/issues/${source.key}/links`, { type: 'blocks', targetKey: target.key })

  const page = await openAs(owner)
  await page.goto(`/projects/${downstreamKey}/board`)
  await page.getByTestId(`issue-card-${source.key}`).click()
  const view = page.getByTestId('issue-view')
  const summary = view.getByTestId('issue-summary')
  const linked = view.getByRole('region', { name: 'Linked issues' })
  const row = linked.getByRole('listitem').filter({ hasText: target.key })
  await expect(summary).toHaveText('Waits for the fix')
  await expect(row).toContainText('To Do')

  // Open the linked issue from there and finish it.
  await row.getByRole('link').click()
  await expect(summary).toHaveText('Upstream fix')
  await view.getByTestId('issue-status').click()
  await pickOption(page, 'Done')
  await expect(view.getByTestId('issue-status')).toContainText('Done')
  await expect.poll(async () => (await owner.api.issue(target.key)).status.name).toBe('Done')

  // Back to the first issue, still cached (well within the 30 s stale time), yet up to date.
  await page.goBack()
  await expect(summary).toHaveText('Waits for the fix')
  await expect(row).toContainText('Done', { timeout: 5_000 })

  // Deleted from there, it leaves the first issue's links too.
  await row.getByRole('link').click()
  await expect(summary).toHaveText('Upstream fix')
  await view.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete issue' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(view).toBeHidden()
  await page.getByTestId(`issue-card-${source.key}`).click()
  await expect(summary).toHaveText('Waits for the fix')
  await expect(linked).toHaveCount(0, { timeout: 5_000 })
})

test('linked issues: deleting a project removes its links from other projects’ issues at once', async ({
  owner,
  openAs,
}) => {
  const doomedKey = newProjectKey('LX')
  const keptKey = newProjectKey('LK')
  await owner.api.createProject(doomedKey, `Doomed ${doomedKey}`, 'kanban')
  await owner.api.createProject(keptKey, `Kept ${keptKey}`, 'kanban')
  const target = await owner.api.createIssue(doomedKey, { summary: 'Goes with its project' })
  const source = await owner.api.createIssue(keptKey, { summary: 'Outlives the link' })
  await owner.api.post(`/issues/${source.key}/links`, { type: 'blocks', targetKey: target.key })

  // No server behind the doomed project's socket: its "project changed" event on deletion
  // would refresh other projects' issue details by itself, and this is about the page's own.
  const page = await openAs(owner)
  await page.routeWebSocket(new RegExp(`/api/projects/${doomedKey}/ws`), () => undefined)
  await page.goto(`/projects/${doomedKey}/board`)

  // Open the other project's issue from the doomed one's, so it is cached.
  await page.getByTestId(`issue-card-${target.key}`).click()
  const view = page.getByTestId('issue-view')
  const summary = view.getByTestId('issue-summary')
  const linked = view.getByRole('region', { name: 'Linked issues' })
  await linked.getByRole('listitem').filter({ hasText: source.key }).getByRole('link').click()
  await expect(summary).toHaveText('Outlives the link')
  await expect(linked.getByRole('listitem').filter({ hasText: target.key })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(view).toBeHidden()

  // Delete the project from its settings.
  await page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Project settings' }).click()
  await page.getByTestId('project-delete').click()
  const confirm = page.getByTestId('delete-project-dialog')
  await confirm.getByTestId('delete-project-confirm-input').fill(doomedKey)
  await confirm.getByRole('button', { name: /^Delete/ }).click()
  await expect(page).toHaveURL(/\/projects$/)

  // Back to the other issue, still cached (well within the 30 s stale time): the link is gone.
  await page.getByTestId(`project-row-${keptKey}`).getByRole('link', { name: `Kept ${keptKey}` }).click()
  await page.getByTestId(`issue-card-${source.key}`).click()
  await expect(summary).toHaveText('Outlives the link')
  await expect(linked).toHaveCount(0, { timeout: 5_000 })
})
