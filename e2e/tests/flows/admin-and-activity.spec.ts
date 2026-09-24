import { ALEX } from '../../support/env.ts'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate } from '../../support/ui.ts'

test('members: change a role, remove a member (their issues become unassigned)', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('MB')
  await owner.api.createProject(key, `Members ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, 'member')
  const issue = await owner.api.createIssue(key, { summary: 'Assigned to the mate', assigneeId: mate.user.id })

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/settings?tab=members`)
  const row = page.getByTestId(`member-${mate.user.id}`)
  await row.getByLabel(`Role of ${mate.user.name}`).selectOption('viewer')
  await expect.poll(async () => (await owner.api.get<{ user: { id: number }; role: string }[]>(`/projects/${key}/members`)).find((m) => m.user.id === mate.user.id)?.role).toBe('viewer')

  // The mate now sees the project read-only (in their own browser).
  const matePage = await openAs(mate)
  await matePage.goto(`/projects/${key}/backlog`)
  await expect(matePage.getByTestId('backlog-page')).toContainText('Read only')

  await row.getByRole('button', { name: `Remove ${mate.user.name}` }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText(`Remove ${mate.user.name}?`)
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toHaveCount(0)
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${mate.user.name} was removed from the project` })).toBeVisible()
  expect((await owner.api.issue(issue.key)).assignee).toBeNull()

  // …and loses access immediately, without reloading.
  await expect(matePage.getByText(/not found/i).first()).toBeVisible()
})

test('columns: deleting a column that has issues moves them to the chosen column', async ({ owner, openAs }) => {
  const key = newProjectKey('CD')
  await owner.api.createProject(key, `Columns ${key}`)
  const statuses = await owner.api.statuses(key)
  const review = statuses.find((s) => s.name === 'In Review')!
  const progress = statuses.find((s) => s.name === 'In Progress')!
  const issue = await owner.api.createIssue(key, { summary: 'Waiting for review', statusId: review.id })

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/settings?tab=columns`)
  const row = page.getByTestId(`column-row-${review.id}`)
  await expect(row).toContainText('1 issue')
  await row.getByRole('button', { name: 'Delete column In Review' }).click()
  const dialog = page.getByTestId('delete-column-dialog')
  await expect(dialog).toContainText('1 issue is in this column.')
  await dialog.getByTestId('delete-column-move-to').selectOption({ label: 'In Progress' })
  await dialog.getByRole('button', { name: 'Delete column' }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toHaveCount(0)
  expect((await owner.api.statuses(key)).map((s) => s.name)).toEqual(['To Do', 'In Progress', 'Done'])
  expect((await owner.api.issue(issue.key)).status.id).toBe(progress.id)
  await expect(page.getByTestId(`column-row-${progress.id}`)).toContainText('1 issue')
})

test('complete sprint from the backlog into the next planned sprint', async ({ owner, openAs }) => {
  const key = newProjectKey('CP')
  await owner.api.createProject(key, `Complete ${key}`)
  const active = await owner.api.createSprint(key)
  const planned = await owner.api.createSprint(key, { name: 'Next up' })
  const open = await owner.api.createIssue(key, { summary: 'Carry me over', sprintId: active.id })
  await owner.api.createIssue(key, { summary: 'Already planned', sprintId: planned.id })
  await owner.api.startSprint(active.id, isoDate(-10), isoDate(4))

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId(`backlog-complete-sprint-${active.id}`).click()
  // Completed in place (like Jira): the dialog opens over the backlog.
  const dialog = page.getByTestId('complete-sprint-dialog')
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/backlog$`))
  await expect(dialog.getByTestId('complete-sprint-target')).toHaveValue(`sprint:${planned.id}`)
  await dialog.getByTestId('complete-sprint-submit').click()
  await expect(dialog).toBeHidden()
  expect((await owner.api.issue(open.key)).sprint?.id).toBe(planned.id)
  const sprints = await owner.api.sprints(key)
  expect(sprints.find((s) => s.id === planned.id)?.issueCount).toBe(2)

  // Still on the backlog, where the next sprint can be started right away.
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/backlog$`))
  await expect(page.getByTestId(`backlog-section-${planned.id}`).getByTestId(`backlog-row-${open.key}`)).toBeVisible()
  await expect(page.getByTestId(`backlog-section-${active.id}`)).toHaveCount(0)
  await expect(page.getByTestId(`backlog-start-sprint-${planned.id}`)).toBeEnabled()
  await expect(page.getByTestId(`backlog-start-sprint-${planned.id}`)).not.toHaveAttribute('aria-disabled', 'true')
})

test('project activity: sentences grouped by day, load more', async ({ demo, openAs }) => {
  const total = (await demo.api.get<unknown[]>('/projects/GB/activity?limit=200')).length
  expect(total).toBeGreaterThan(50)
  const page = await openAs(demo)
  await page.goto('/projects/GB/activity')
  const items = page.locator('[data-testid^="activity-"]:not([data-testid="activity-load-more"])')
  await expect(items).toHaveCount(50)
  await expect(items.first()).toContainText(/ (created|changed|set|added|commented|moved|assigned|linked|started|completed|updated|reassigned)/)
  await page.getByTestId('activity-load-more').click()
  await expect(items).toHaveCount(Math.min(100, total))
  // The feed starts with the project's creation, at the very end.
  while (await page.getByTestId('activity-load-more').isVisible()) {
    await page.getByTestId('activity-load-more').click()
    await page.waitForTimeout(200)
  }
  await expect(items).toHaveCount(total)
  await expect(items.last()).toContainText('created the project')
  await expect(page.getByText(/That’s everything since the project was created/)).toBeVisible()
  // The member list shows up in the activity: Alex was added when GB was seeded.
  await expect(page.getByText(`added ${ALEX.name}`, { exact: false }).first()).toBeVisible()
})
