import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { dragTo, testIdKeys } from '../../support/ui.ts'

test('backlog: create a sprint, drag issues into it, reorder, and start it', async ({ owner, openAs }) => {
  const key = newProjectKey('BL')
  await owner.api.createProject(key, `Backlog ${key}`)
  const keys: string[] = []
  for (const summary of ['Alpha task', 'Bravo task', 'Charlie task', 'Delta task']) {
    keys.push((await owner.api.createIssue(key, { summary, storyPoints: 2 })).key)
  }
  const [a, b, c, d] = keys

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  const backlog = page.getByTestId('backlog-section-backlog')
  await expect(backlog.getByTestId(`backlog-row-${d}`)).toBeVisible()
  expect(await testIdKeys(backlog, 'backlog-row-')).toEqual([a, b, c, d])

  // --- create a sprint
  await page.getByTestId('backlog-create-sprint').click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${key} Sprint 1 created` })).toBeVisible()
  const [sprint] = await owner.api.sprints(key)
  expect(sprint).toMatchObject({ name: `${key} Sprint 1`, state: 'planned' })
  const sprintSection = page.getByTestId(`backlog-section-${sprint.id}`)
  await expect(sprintSection).toBeVisible()
  await expect(sprintSection).toContainText('0 issues')

  // --- drag Bravo from the backlog into the (empty) sprint
  await dragTo(page, backlog.getByTestId(`backlog-row-${b}`), sprintSection, {
    beforeDrop: () => expect(sprintSection.getByTestId(`backlog-row-${b}`)).toBeVisible(),
  })
  await expect(sprintSection.getByTestId(`backlog-row-${b}`)).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(b)).sprint?.id).toBe(sprint.id)

  // …and Delta after it: drop below the sprint's last row (hovering a row takes that row's slot)
  await dragTo(page, backlog.getByTestId(`backlog-row-${d}`), sprintSection.getByTestId(`backlog-quick-create-sprint-${sprint.id}`), {
    beforeDrop: () => expect.poll(() => testIdKeys(sprintSection, 'backlog-row-')).toEqual([b, d]),
  })
  await expect(sprintSection.getByTestId(`backlog-row-${d}`)).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(d)).sprint?.id).toBe(sprint.id)
  await expect.poll(() => testIdKeys(sprintSection, 'backlog-row-')).toEqual([b, d])
  await expect(sprintSection).toContainText('2 issues')

  // --- reorder inside the backlog: Charlie to the top (above Alpha)
  expect(await testIdKeys(backlog, 'backlog-row-')).toEqual([a, c])
  await dragTo(page, backlog.getByTestId(`backlog-row-${c}`), backlog.getByTestId(`backlog-row-${a}`), 'top')
  await expect.poll(() => testIdKeys(backlog, 'backlog-row-')).toEqual([c, a])
  // Server order (rank) follows.
  await expect
    .poll(async () => (await owner.api.backlog(key)).backlog.map((i) => i.key))
    .toEqual([c, a])

  // --- reorder inside the sprint: Delta above Bravo
  await dragTo(page, sprintSection.getByTestId(`backlog-row-${d}`), sprintSection.getByTestId(`backlog-row-${b}`), 'top')
  await expect.poll(() => testIdKeys(sprintSection, 'backlog-row-')).toEqual([d, b])
  await expect
    .poll(async () => (await owner.api.backlog(key)).sprints[0].issues.map((i) => i.key))
    .toEqual([d, b])

  // The order survives a reload.
  await page.reload()
  await expect(backlog.getByTestId(`backlog-row-${a}`)).toBeVisible()
  expect(await testIdKeys(backlog, 'backlog-row-')).toEqual([c, a])
  expect(await testIdKeys(sprintSection, 'backlog-row-')).toEqual([d, b])

  // --- start the sprint (defaults: starts today, 2 weeks)
  await sprintSection.getByTestId(`backlog-start-sprint-${sprint.id}`).click()
  const dialog = page.getByTestId('start-sprint-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('2 issues will be included in this sprint.')
  await dialog.getByTestId('sprint-goal').fill('Ship the first slice')
  await dialog.getByTestId('start-sprint-submit').click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${key} Sprint 1 started` })).toBeVisible()
  await expect(sprintSection.getByTestId(`backlog-complete-sprint-${sprint.id}`)).toBeVisible()

  const started = (await owner.api.sprints(key))[0]
  expect(started).toMatchObject({ id: sprint.id, state: 'active', goal: 'Ship the first slice' })
  expect(started.startDate).not.toBeNull()
  expect(started.endDate).not.toBeNull()

  // The board now shows the sprint's issues.
  await page.getByRole('link', { name: 'Board', exact: true }).click()
  await expect(page.getByTestId(`issue-card-${d}`)).toBeVisible()
  await expect(page.getByTestId(`issue-card-${b}`)).toBeVisible()
  await expect(page.locator('[data-testid^="issue-card-"]')).toHaveCount(2)
})
