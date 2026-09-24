import { expect, newProjectKey, test } from '../../support/fixtures.ts'

test('realtime: backlog and an open issue modal follow another user’s changes', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('RT')
  await owner.api.createProject(key, `Live ${key}`)
  const mate = await newUser('Watcher')
  await owner.api.addMember(key, mate.user.email, 'member')
  const sprint = await owner.api.createSprint(key)
  const issue = await owner.api.createIssue(key, { summary: 'Watch me move', priority: 'low' })

  const page = await openAs(mate)
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes(`/api/projects/${key}/ws`))
  await page.goto(`/projects/${key}/backlog`)
  await socket
  await expect(page.getByTestId('backlog-section-backlog').getByTestId(`backlog-row-${issue.key}`)).toBeVisible()
  await page.waitForTimeout(300)

  // The owner plans the issue into the sprint → it jumps sections on the watcher's screen.
  await owner.api.post(`/issues/${issue.key}/move`, { sprintId: sprint.id })
  await expect(page.getByTestId(`backlog-section-${sprint.id}`).getByTestId(`backlog-row-${issue.key}`)).toBeVisible()

  // A new issue appears without reloading.
  const created = await owner.api.createIssue(key, { summary: 'Appears live' })
  await expect(page.getByTestId(`backlog-row-${created.key}`)).toBeVisible()

  // With the issue open, the owner's edits show up in the modal.
  await page.getByTestId(`backlog-row-${issue.key}`).click()
  const view = page.getByTestId('issue-view')
  await expect(view.getByRole('button', { name: 'Priority: Low' })).toBeVisible()
  await owner.api.patch(`/issues/${issue.key}`, { priority: 'highest', summary: 'Watch me change' })
  await expect(view.getByRole('button', { name: 'Priority: Highest' })).toBeVisible()
  await expect(view.getByTestId('issue-summary')).toHaveText('Watch me change')
  await owner.api.post(`/issues/${issue.key}/comments`, { body: 'Comment from the owner' })
  await expect(view.getByText('Comment from the owner')).toBeVisible()

  // Deleted issues disappear from the backlog…
  await owner.api.delete(`/issues/${created.key}`)
  await expect(page.getByTestId(`backlog-row-${created.key}`)).toHaveCount(0)
  // …and the open modal says its issue is gone.
  await owner.api.delete(`/issues/${issue.key}`)
  await expect(page.getByRole('dialog').getByText('Issue not found or you don’t have access')).toBeVisible()
  await expect(page.getByTestId(`backlog-row-${issue.key}`)).toHaveCount(0)
})
