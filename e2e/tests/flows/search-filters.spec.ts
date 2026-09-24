import type { Page } from '@playwright/test'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate, testIdKeys } from '../../support/ui.ts'

/** Row keys of the results table, sorted (display order is covered separately). */
const rowKeys = async (page: Page) => (await testIdKeys(page.getByTestId('issues-table'), 'issue-row-')).sort()

/** Picks `option` in the filter menu labelled `label`, then closes the menu. */
async function pickFilter(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('button', { name: new RegExp(`^${label} filter`) }).click()
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: option }).click()
  await page.keyboard.press('Escape')
}

test('issue search: sprint filters across projects, project-scoped filters on /issues, reporter, epic, created sort', async ({
  owner,
  newUser,
  openAs,
}) => {
  const reporter = await newUser('Reporter')
  const p = newProjectKey('SP')
  const q = newProjectKey('SQ')
  await owner.api.createProject(p, `Search P ${p}`)
  await owner.api.createProject(q, `Search Q ${q}`)
  await owner.api.addMember(p, reporter.user.email, 'member')

  const sprintP = await owner.api.createSprint(p)
  const sprintQ = await owner.api.createSprint(q)
  const inSprintP = await owner.api.createIssue(p, { summary: 'Sprint work in P', sprintId: sprintP.id })
  const inSprintQ = await owner.api.createIssue(q, { summary: 'Sprint work in Q', sprintId: sprintQ.id })
  await owner.api.startSprint(sprintP.id, isoDate(-2), isoDate(12))
  await owner.api.startSprint(sprintQ.id, isoDate(-2), isoDate(12))
  const label = await owner.api.post<{ id: number }>(`/projects/${p}/labels`, { name: 'payments' })
  const labelled = await owner.api.createIssue(p, { summary: 'Labelled backlog item', labelIds: [label.id] })
  const epic = await owner.api.createIssue(p, { type: 'epic', summary: 'Onboarding epic' })
  const child = await owner.api.createIssue(p, { type: 'story', summary: 'Welcome email', parentId: epic.id })
  const reported = await reporter.api.createIssue(p, { summary: 'Reported by someone else' })
  const backlogQ = await owner.api.createIssue(q, { summary: 'Backlog of Q' })

  const page = await openAs(owner)

  // Active sprints across all projects (Jira's openSprints()), straight from the URL…
  await page.goto('/issues?sprint=active')
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  await expect.poll(() => rowKeys(page)).toEqual([inSprintP.key, inSprintQ.key].sort())
  await expect(page.getByRole('button', { name: 'Sprint filter: 1 selected' })).toBeVisible()
  // …or from the Sprint menu: the backlog of every project.
  await page.goto('/issues')
  await pickFilter(page, 'Sprint', 'Backlog')
  await expect(page).toHaveURL(/[?&]sprint=none/)
  await expect(page.getByTestId('issues-count')).toHaveText('5 issues')
  await expect.poll(() => rowKeys(page)).toEqual([labelled.key, epic.key, child.key, reported.key, backlogQ.key].sort())

  // Picking a project on /issues brings its own filters (labels here).
  await page.goto('/issues')
  await expect(page.getByRole('button', { name: /^Label filter/ })).toHaveCount(0)
  await pickFilter(page, 'Project', `Search P ${p}`)
  await pickFilter(page, 'Label', 'payments')
  await expect(page).toHaveURL(new RegExp(`[?&]label=${label.id}`))
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')
  await expect.poll(() => rowKeys(page)).toEqual([labelled.key])
  // A shared link with a project and a label keeps both.
  await page.goto(`/issues?project=${p}&label=${label.id}`)
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')
  await expect(page.getByRole('button', { name: 'Label filter: 1 selected' })).toBeVisible()
  // Switching the project drops the other project's label.
  await pickFilter(page, 'Project', `Search Q ${q}`)
  await expect(page).not.toHaveURL(/label=/)
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')

  // Reporter: a project member, or "Me" (also across projects).
  await page.goto(`/projects/${p}/issues`)
  await pickFilter(page, 'Reporter', new RegExp(reporter.user.name))
  await expect(page).toHaveURL(new RegExp(`[?&]reporter=${reporter.user.id}`))
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')
  await expect.poll(() => rowKeys(page)).toEqual([reported.key])
  await page.goto('/issues?reporter=me')
  await expect(page.getByTestId('issues-count')).toHaveText('6 issues')
  await expect.poll(() => rowKeys(page)).not.toContain(reported.key)

  // Epic: the epic's child issues.
  await page.goto(`/projects/${p}/issues`)
  await pickFilter(page, 'Epic', 'Onboarding epic')
  await expect(page).toHaveURL(new RegExp(`[?&]epic=${epic.id}`))
  await expect(page.getByTestId('issues-count')).toHaveText('1 issue')
  await expect.poll(() => rowKeys(page)).toEqual([child.key])

  // Created: newest first, then oldest first.
  await page.goto(`/projects/${q}/issues`)
  await page.getByRole('columnheader', { name: 'Created' }).getByRole('button').click()
  await expect(page).toHaveURL(/[?&]sort=created/)
  await expect(page.getByRole('columnheader', { name: 'Created' })).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(() => testIdKeys(page.getByTestId('issues-table'), 'issue-row-')).toEqual([backlogQ.key, inSprintQ.key])
  await page.getByRole('columnheader', { name: 'Created' }).getByRole('button').click()
  await expect(page.getByRole('columnheader', { name: 'Created' })).toHaveAttribute('aria-sort', 'ascending')
  await expect.poll(() => testIdKeys(page.getByTestId('issues-table'), 'issue-row-')).toEqual([inSprintQ.key, backlogQ.key])
})
