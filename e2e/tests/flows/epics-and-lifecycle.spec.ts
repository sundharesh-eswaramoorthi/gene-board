import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { fieldControl, pickOption } from '../../support/ui.ts'

test('epics page: create an epic, add a child, progress follows the child', async ({ owner, openAs }) => {
  const key = newProjectKey('EP')
  await owner.api.createProject(key, `Epics ${key}`)
  const page = await openAs(owner)
  await page.goto(`/projects/${key}/epics`)
  await expect(page.getByText('No epics yet', { exact: true })).toBeVisible()

  // "Create epic" opens the Create modal preset to Epic.
  await page.getByRole('button', { name: 'Create epic' }).first().click()
  const modal = page.getByTestId('create-issue-modal')
  await expect(fieldControl(modal, 'Issue type')).toContainText('Epic')
  await modal.getByTestId('create-issue-summary').fill('Mobile app')
  await modal.getByTestId('create-issue-submit').click()
  await expect(modal).toBeHidden()
  const epicKey = `${key}-1`
  const row = page.getByTestId(`epic-row-${epicKey}`)
  await expect(row).toContainText('Mobile app')
  await expect(row).toContainText('No child issues')

  // Expand it and add a child story from the row.
  await row.getByRole('button', { name: `Expand ${epicKey}` }).click()
  await page.getByTestId(`epic-add-child-${epicKey}`).click()
  await expect(fieldControl(modal, 'Issue type')).toContainText('Story')
  await expect(fieldControl(modal, 'Epic')).toContainText(epicKey)
  await modal.getByTestId('create-issue-summary').fill('Offline mode')
  await modal.getByTestId('create-issue-submit').click()
  await expect(modal).toBeHidden()
  const childKey = `${key}-2`
  await expect(row).toContainText('0/1 done · 0%')
  await expect(row).toContainText('Offline mode')
  expect((await owner.api.issue(childKey)).parent?.key).toBe(epicKey)

  // Another user finishing the child updates the progress live (no reload).
  const done = (await owner.api.statuses(key)).find((s) => s.category === 'done')!
  await owner.api.post(`/issues/${childKey}/move`, { statusId: done.id })
  await expect(row).toContainText('1/1 done · 100%')
})

test('issue lifecycle: create another, back button closes the modal, delete', async ({ owner, openAs }) => {
  const key = newProjectKey('LC')
  await owner.api.createProject(key, `Lifecycle ${key}`)
  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog`)
  await expect(page.getByTestId('backlog-section-backlog')).toBeVisible()

  // "Create another" keeps the dialog open with the other fields, clearing only the summary.
  await page.getByTestId('backlog-create-issue').click()
  const modal = page.getByTestId('create-issue-modal')
  await fieldControl(modal, 'Priority').click()
  await pickOption(page, /^High$/)
  await modal.getByText('Create another').click()
  await modal.getByTestId('create-issue-summary').fill('First of two')
  await modal.getByTestId('create-issue-submit').click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${key}-1` })).toBeVisible()
  await expect(modal).toBeVisible()
  await expect(modal.getByTestId('create-issue-summary')).toHaveValue('')
  await expect(modal.getByTestId('create-issue-summary')).toBeFocused()
  await modal.getByTestId('create-issue-summary').fill('Second of two')
  await modal.getByTestId('create-issue-summary').press('Enter')
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${key}-2` })).toBeVisible()
  await modal.getByRole('button', { name: 'Cancel' }).click()
  await expect(modal).toBeHidden()
  for (const k of [`${key}-1`, `${key}-2`]) {
    expect((await owner.api.issue(k)).priority).toBe('high')
    await expect(page.getByTestId(`backlog-row-${k}`)).toBeVisible()
  }

  // Opening an issue adds ?issue= to the history: Back closes the modal.
  await page.getByTestId(`backlog-row-${key}-1`).click()
  await expect(page.getByTestId('issue-view')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`[?&]issue=${key}-1`))
  await page.goBack()
  await expect(page.getByTestId('issue-view')).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/backlog$`))

  // Delete from the modal's menu, with confirmation.
  await page.getByTestId(`backlog-row-${key}-2`).click()
  const view = page.getByTestId('issue-view')
  await view.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete issue' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText(`Delete ${key}-2?`)
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${key}-2 was deleted` })).toBeVisible()
  await expect(view).toBeHidden()
  await expect(page.getByTestId(`backlog-row-${key}-2`)).toHaveCount(0)
  await expect(page.getByTestId(`backlog-row-${key}-1`)).toBeVisible()
  const res = await page.request.get(`/api/issues/${key}-2`, { headers: { Authorization: `Bearer ${owner.token}` } })
  expect(res.status()).toBe(404)

  // The deleted issue's page says so.
  await page.goto(`/browse/${key}-2`)
  await expect(page.getByText('Issue not found or you don’t have access')).toBeVisible()
})
