import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate, pickOption } from '../../support/ui.ts'

test('issue view: status, type, sprint and due date; comment edit/delete; unlink', async ({ owner, openAs }) => {
  const key = newProjectKey('IM')
  await owner.api.createProject(key, `More ${key}`)
  const sprint = await owner.api.createSprint(key, { name: 'Sprint Alpha' })
  const issue = await owner.api.createIssue(key, { type: 'task', summary: 'Tune the query planner' })
  const other = await owner.api.createIssue(key, { type: 'task', summary: 'Collect slow query logs' })
  await owner.api.post(`/issues/${issue.key}/links`, { type: 'relates', targetKey: other.key })
  await owner.api.post(`/issues/${issue.key}/comments`, { body: 'First draft of the comment' })

  const page = await openAs(owner)
  await page.goto(`/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  await expect(view.getByRole('heading', { level: 1 })).toHaveText('Tune the query planner')

  // Status from the prominent status button.
  await view.getByTestId('issue-status').click()
  await pickOption(page, 'In Review')
  await expect(view.getByTestId('issue-status')).toContainText('In Review')
  await expect.poll(async () => (await owner.api.issue(issue.key)).status.name).toBe('In Review')

  // Type from the breadcrumb (task → bug).
  await view.getByRole('button', { name: 'Issue type: Task. Change type' }).click()
  await pickOption(page, 'Bug')
  await expect(view.getByRole('button', { name: 'Issue type: Bug. Change type' })).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(issue.key)).type).toBe('bug')

  // Sprint: backlog → Sprint Alpha.
  await view.getByRole('button', { name: 'Sprint: None (backlog)' }).click()
  await pickOption(page, 'Sprint Alpha')
  await expect(view.getByRole('button', { name: 'Sprint: Sprint Alpha' })).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(issue.key)).sprint?.id).toBe(sprint.id)

  // Due date: a value set without typing counts as a calendar pick and saves at once.
  const due = isoDate(10)
  await view.getByRole('button', { name: /^Due date/ }).click()
  await view.getByLabel('Due date', { exact: true }).and(view.locator('input')).fill(due)
  await expect.poll(async () => (await owner.api.issue(issue.key)).dueDate).toBe(due)
  await expect(view.getByRole('button', { name: /^Due date/ })).toBeVisible()

  // Edit the comment, then delete it.
  const comments = view.getByRole('tabpanel')
  await expect(comments.getByText('First draft of the comment')).toBeVisible()
  await comments.getByRole('button', { name: 'Edit', exact: true }).click()
  await comments.getByRole('textbox', { name: 'Edit comment' }).fill('Final wording of the comment')
  await comments.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(comments.getByText('Final wording of the comment')).toBeVisible()
  await expect(comments.getByText('(edited)')).toBeVisible()
  await comments.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: /^Delete/ }).click()
  await expect(comments.getByText('Final wording of the comment')).toHaveCount(0)
  await expect.poll(async () => (await owner.api.get<unknown[]>(`/issues/${issue.key}/comments`)).length).toBe(0)

  // Remove the link.
  const linked = view.getByRole('region', { name: 'Linked issues' })
  await expect(linked).toContainText(other.key)
  await linked.getByRole('listitem').filter({ hasText: other.key }).hover()
  await linked.getByRole('button', { name: `Remove link to ${other.key}` }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Remove this link?')
  await confirm.getByRole('button', { name: 'Remove link' }).click()
  await expect(confirm).toBeHidden()
  // With no links left the section goes away (the toolbar's "Link issue" stays).
  await expect(linked).toHaveCount(0)
  await expect(view.getByRole('button', { name: 'Link issue' })).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(issue.key)).links.length).toBe(0)

  // History has all of it.
  await view.getByRole('tab', { name: 'History' }).click()
  const history = view.getByRole('tabpanel')
  const me = owner.user.name
  for (const sentence of [
    `${me} changed Status from To Do to In Review`,
    `${me} changed Type from Task to Bug`,
    `${me} moved the issue to Sprint Alpha`,
    `${me} set Due date to`,
    `${me} removed link: relates to ${other.key}`,
  ]) {
    await expect(history.getByText(sentence, { exact: false })).toBeVisible()
  }
})

test('account settings: rename yourself; the new name shows in the app', async ({ newUser, openAs }) => {
  const user = await newUser('Renamer')
  const page = await openAs(user)
  await page.goto('/')
  await page.getByRole('button', { name: `Account menu for ${user.user.name}` }).click()
  await page.getByRole('menuitem', { name: 'Account settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Full name').fill(`Renamed ${user.user.name}`)
  await dialog.getByRole('button', { name: /^Save/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Account menu for Renamed ${user.user.name}` })).toBeVisible()
  expect((await user.api.get<{ name: string }>('/auth/me')).name).toBe(`Renamed ${user.user.name}`)
})

test('projects: a taken key is refused; deleting a project needs its key typed', async ({ owner, openAs }) => {
  const key = newProjectKey('DL')
  await owner.api.createProject(key, `Doomed ${key}`)
  const page = await openAs(owner)

  // The create dialog suggests a key and refuses one that exists.
  await page.goto('/projects')
  await page.getByTestId('projects-create').click()
  const dialog = page.getByTestId('create-project-dialog')
  await dialog.getByTestId('create-project-name').fill('Payments Platform')
  await expect(dialog.getByTestId('create-project-key')).toHaveValue('PP')
  await dialog.getByTestId('create-project-key').fill(key)
  await expect(dialog).toContainText('A project with this key already exists')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Delete from settings: the button stays disabled until the key is typed.
  await page.goto(`/projects/${key}/settings`)
  await page.getByTestId('project-delete').click()
  const confirm = page.getByTestId('delete-project-dialog')
  const submit = confirm.getByRole('button', { name: /^Delete/ })
  await expect(submit).toBeDisabled()
  await confirm.getByTestId('delete-project-confirm-input').fill(key)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByTestId(`project-row-${key}`)).toHaveCount(0)
  const res = await page.request.get(`/api/projects/${key}`, { headers: { Authorization: `Bearer ${owner.token}` } })
  expect(res.status()).toBe(404)
})
