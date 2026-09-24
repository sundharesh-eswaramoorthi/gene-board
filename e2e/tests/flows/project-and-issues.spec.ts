import type { Page } from '@playwright/test'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { fieldControl, pickOption } from '../../support/ui.ts'

/** Creates an issue through the top-nav Create modal and returns the key announced in the toast. */
async function createViaModal(
  page: Page,
  { type, summary, epic }: { type: 'Epic' | 'Story' | 'Task' | 'Bug'; summary: string; epic?: string },
): Promise<string> {
  await page.getByTestId('nav-create-issue').click()
  const modal = page.getByTestId('create-issue-modal')
  await expect(modal).toBeVisible()
  await fieldControl(modal, 'Issue type').click()
  await pickOption(page, type)
  await expect(fieldControl(modal, 'Issue type')).toContainText(type)
  await modal.getByTestId('create-issue-summary').fill(summary)
  if (epic) {
    await fieldControl(modal, 'Epic').click()
    await pickOption(page, new RegExp(epic), epic)
    await expect(fieldControl(modal, 'Epic')).toContainText(epic)
  }
  await modal.getByTestId('create-issue-submit').click()
  await expect(modal).toBeHidden()
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'has been created' }).filter({ hasText: summary })
  await expect(toast).toBeVisible()
  const key = (await toast.getByRole('button', { name: /^[A-Z][A-Z0-9]+-\d+$/ }).textContent())?.trim() ?? ''
  expect(key).toMatch(/^[A-Z][A-Z0-9]+-\d+$/)
  return key
}

test('create a Scrum project, see the empty board, then build an issue hierarchy', async ({ owner, openAs }) => {
  const key = newProjectKey('SC')
  const name = `Scrum ${key}`
  const page = await openAs(owner)

  // --- create the project from the Projects page
  await page.goto('/projects')
  await page.getByTestId('projects-create').click()
  const dialog = page.getByTestId('create-project-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('create-project-name').fill(name)
  await dialog.getByTestId('create-project-key').fill(key)
  await dialog.getByTestId('project-type-scrum').click()
  await dialog.getByTestId('create-project-submit').click()

  // → the new project's board: no active sprint yet
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/board$`))
  await expect(page.getByText('No active sprint', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Go to Backlog' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/backlog$`))
  await expect(page.getByTestId('backlog-section-backlog')).toContainText('Your backlog is empty')

  const project = await owner.api.get<{ key: string; name: string; type: string; myRole: string }>(`/projects/${key}`)
  expect(project).toMatchObject({ key, name, type: 'scrum', myRole: 'admin' })

  // --- issues through the Create modal: keys are numbered 1, 2, 3, …
  const epicSummary = `Checkout epic ${key}`
  const epicKey = await createViaModal(page, { type: 'Epic', summary: epicSummary })
  expect(epicKey).toBe(`${key}-1`)
  const storyKey = await createViaModal(page, { type: 'Story', summary: 'Pay with saved card', epic: epicSummary })
  expect(storyKey).toBe(`${key}-2`)
  const taskKey = await createViaModal(page, { type: 'Task', summary: 'Set up payment provider sandbox' })
  expect(taskKey).toBe(`${key}-3`)
  const bugKey = await createViaModal(page, { type: 'Bug', summary: 'Total rounds the wrong way' })
  expect(bugKey).toBe(`${key}-4`)

  // The backlog lists the three standard issues (epics live in the Epics panel).
  const backlog = page.getByTestId('backlog-section-backlog')
  for (const k of [storyKey, taskKey, bugKey]) await expect(backlog.getByTestId(`backlog-row-${k}`)).toBeVisible()
  await expect(backlog.getByTestId(`backlog-row-${epicKey}`)).toHaveCount(0)

  const story = await owner.api.issue(storyKey)
  expect(story.type).toBe('story')
  expect(story.parent?.key).toBe(epicKey)
  expect((await owner.api.issue(bugKey)).type).toBe('bug')

  // --- subtask through the issue view's child-issue inline create
  await backlog.getByTestId(`backlog-row-${storyKey}`).click()
  const view = page.getByTestId('issue-view')
  await expect(view).toHaveAttribute('data-issue-key', storyKey)
  await view.getByRole('button', { name: 'Create subtask' }).click()
  await view.getByLabel('Summary of the new subtask').fill('Validate card expiry')
  await view.getByLabel('Summary of the new subtask').press('Enter')
  const subtaskKey = `${key}-5`
  const subtasks = view.getByRole('region', { name: 'Subtasks' })
  await expect(subtasks).toContainText(subtaskKey)
  await expect(subtasks).toContainText('Validate card expiry')
  await expect(subtasks.getByText('0 of 1 done')).toBeVisible()

  const subtask = await owner.api.issue(subtaskKey)
  expect(subtask).toMatchObject({ type: 'subtask', summary: 'Validate card expiry' })
  expect(subtask.parent?.key).toBe(storyKey)

  // The epic lists its child story.
  const epic = await owner.api.issue(epicKey)
  expect(epic.children.map((c) => c.key)).toEqual([storyKey])
})
