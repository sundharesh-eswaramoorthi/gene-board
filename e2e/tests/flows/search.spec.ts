import type { Page } from '@playwright/test'
import { expect, newProjectKey, test, uid } from '../../support/fixtures.ts'
import { testIdKeys } from '../../support/ui.ts'

/** Row keys of the results table, in display order. */
const rowKeys = (page: Page) => testIdKeys(page.getByTestId('issues-table'), 'issue-row-')

test('issue search: filters, URL sync, back button, and rows open the issue', async ({ owner, openAs }) => {
  const key = newProjectKey('SR')
  const word = `zeta${uid(4).toLowerCase()}`
  await owner.api.createProject(key, `Search ${key}`)
  const label = await owner.api.post<{ id: number; name: string }>(`/projects/${key}/labels`, { name: 'frontend' })
  const story = await owner.api.createIssue(key, {
    type: 'story',
    summary: `${word} login page redesign`,
    priority: 'high',
    assigneeId: owner.user.id,
    labelIds: [label.id],
  })
  const bug = await owner.api.createIssue(key, { type: 'bug', summary: `${word} login fails on Safari`, priority: 'highest' })
  const task = await owner.api.createIssue(key, { type: 'task', summary: 'Update the docs', priority: 'low', assigneeId: owner.user.id })
  const epic = await owner.api.createIssue(key, { type: 'epic', summary: 'Authentication' })

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/issues`)
  await expect(page.getByTestId('issues-count')).toHaveText('4 issues')
  expect((await rowKeys(page)).sort()).toEqual([story.key, bug.key, task.key, epic.key].sort())

  // Text search → ?q=
  await page.getByTestId('issues-search').fill(word)
  await page.getByTestId('issues-search').press('Enter')
  await expect(page).toHaveURL(new RegExp(`[?&]q=${word}`))
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  expect((await rowKeys(page)).sort()).toEqual([story.key, bug.key].sort())

  // Type filter → ?type=bug (combined with the text)
  await page.getByRole('button', { name: 'Type filter' }).click()
  await page.getByRole('listbox', { name: 'Type' }).getByRole('option', { name: 'Bug' }).click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/[?&]type=bug/)
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')
  expect(await rowKeys(page)).toEqual([bug.key])
  await expect(page.getByRole('button', { name: 'Type filter: 1 selected' })).toContainText('Type: Bug')

  // Back restores the previous search (text only)…
  await page.goBack()
  await expect(page).not.toHaveURL(/type=bug/)
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  // …and Forward re-applies the filter.
  await page.goForward()
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')

  // A shared URL restores every filter: my open issues with the label, priority high or low.
  await page.goto(`/projects/${key}/issues?assignee=me&priority=high,low`)
  await expect(page.getByRole('button', { name: 'Priority filter: 2 selected' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assignee filter: 1 selected' })).toBeVisible()
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  expect((await rowKeys(page)).sort()).toEqual([story.key, task.key].sort())

  // Label filter narrows further and lands in the URL.
  await page.getByRole('button', { name: 'Label filter' }).click()
  await page.getByRole('listbox', { name: 'Label' }).getByRole('option', { name: 'frontend' }).click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`[?&]label=${label.id}`))
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')
  expect(await rowKeys(page)).toEqual([story.key])

  // Clicking a row opens the issue modal on top of the results, keeping the filters.
  await page.getByTestId(`issue-row-${story.key}`).click()
  const view = page.getByTestId('issue-view')
  await expect(view).toHaveAttribute('data-issue-key', story.key)
  await expect(page).toHaveURL(new RegExp(`[?&]issue=${story.key}`))
  await expect(page).toHaveURL(/assignee=me/)
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  await expect(page).not.toHaveURL(/issue=/)
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')

  // No matches → empty state.
  await page.goto(`/projects/${key}/issues?q=nothing-matches-${word}`)
  await expect(page.getByTestId('issues-empty')).toBeVisible()

  // The global search (top nav): an exact issue key opens that issue (like Jira's quick
  // search), in any letter case…
  await page.goto('/')
  const globalSearch = page.getByRole('banner').getByRole('searchbox', { name: 'Search issues' })
  await globalSearch.fill(bug.key.toLowerCase())
  await page.keyboard.press('Enter')
  await expect(view).toHaveAttribute('data-issue-key', bug.key)
  await expect(page).toHaveURL(new RegExp(`/\\?issue=${bug.key}$`))
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  // …and any other text searches all projects.
  await globalSearch.fill(word)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/issues\\?q=${word}`))
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  expect((await rowKeys(page)).sort()).toEqual([story.key, bug.key].sort())
})
