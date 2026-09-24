import type { Page } from '@playwright/test'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { fieldControl } from '../../support/ui.ts'

/** Records the bodies of API requests matching `method` and a path prefix. */
function recordRequests(page: Page, method: string, pathPrefix: string): string[] {
  const bodies: string[] = []
  page.on('request', (req) => {
    if (req.method() === method && new URL(req.url()).pathname.startsWith(pathPrefix)) bodies.push(req.postData() ?? '')
  })
  return bodies
}

const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]').filter({ hasText: text })

test('number fields reject text the browser cannot parse instead of clearing the value', async ({ owner, openAs }) => {
  const key = newProjectKey('NF')
  await owner.api.createProject(key, `Numbers ${key}`)
  const issue = await owner.api.createIssue(key, { type: 'story', summary: 'Estimate me', storyPoints: 5 })
  const inProgress = (await owner.api.statuses(key)).find((s) => s.name === 'In Progress')!
  await owner.api.patch(`/projects/${key}/statuses/${inProgress.id}`, { wipLimit: 3 })

  const page = await openAs(owner)
  const issuePatches = recordRequests(page, 'PATCH', `/api/issues/${issue.key}`)
  await page.goto(`/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')

  // "5" + "e" reads as '' (badInput): Enter shows the error and keeps editing…
  await view.getByRole('button', { name: /^Story points: 5/ }).click()
  const points = view.getByRole('spinbutton', { name: 'Story points' })
  await points.press('End')
  await page.keyboard.type('e')
  await points.press('Enter')
  await expect(toast(page, 'Story points must be a number from 0 to 1000').first()).toBeVisible()
  await expect(points).toBeVisible()
  // …and leaving the field discards the unparseable text rather than clearing the estimate.
  await points.press('Tab')
  await expect(view.getByRole('button', { name: /^Story points: 5/ })).toBeVisible()
  expect(issuePatches).toEqual([])
  expect((await owner.api.issue(issue.key)).storyPoints).toBe(5)

  // WIP limit: "3" + "e" is refused and the saved limit stays.
  const statusPatches = recordRequests(page, 'PATCH', `/api/projects/${key}/statuses/`)
  await page.goto(`/projects/${key}/settings?tab=columns`)
  const wip = page.getByRole('spinbutton', { name: 'WIP limit of In Progress' })
  await expect(wip).toHaveValue('3')
  await wip.click()
  await wip.press('End')
  await page.keyboard.type('e')
  await wip.press('Enter')
  await expect(toast(page, 'The WIP limit must be a whole number').first()).toBeVisible()
  await expect(wip).toHaveValue('3')
  expect(statusPatches).toEqual([])
  expect((await owner.api.statuses(key)).find((s) => s.id === inProgress.id)?.wipLimit).toBe(3)

  // Create issue: "-" in Story points is an error, not "no estimate".
  const creates = recordRequests(page, 'POST', `/api/projects/${key}/issues`)
  await page.goto(`/projects/${key}/issues`)
  await page.getByRole('button', { name: 'Create issue' }).first().click()
  const dialog = page.getByTestId('create-issue-modal')
  await dialog.getByTestId('create-issue-summary').fill('Needs a real estimate')
  await fieldControl(dialog, 'Story points').click()
  await page.keyboard.type('-')
  await dialog.getByTestId('create-issue-submit').click()
  await expect(dialog.getByText('Enter a number from 0 to 1000')).toBeVisible()
  expect(creates).toEqual([])
  await fieldControl(dialog, 'Story points').fill('3')
  await dialog.getByTestId('create-issue-submit').click()
  await expect(dialog).toBeHidden()
  expect(creates).toHaveLength(1)
  expect(JSON.parse(creates[0])).toMatchObject({ storyPoints: 3 })
})

test('issue modal: leaving with an unsaved comment or description asks first', async ({ owner, openAs }) => {
  const key = newProjectKey('DR')
  await owner.api.createProject(key, `Drafts ${key}`)
  const issue = await owner.api.createIssue(key, { type: 'task', summary: 'Write things down' })
  const other = await owner.api.createIssue(key, { type: 'task', summary: 'Another one' })
  await owner.api.post(`/issues/${issue.key}/links`, { type: 'relates', targetKey: other.key })

  const page = await openAs(owner)
  // Opened from the page (not by URL), so Back is an in-app navigation.
  await page.goto(`/projects/${key}/backlog`)
  await page.getByTestId(`backlog-row-${issue.key}`).click()
  const view = page.getByTestId('issue-view')
  await expect(view).toHaveAttribute('data-issue-key', issue.key)
  const discard = page.getByRole('alertdialog').filter({ hasText: 'Discard unsaved changes?' })

  // A comment draft: clicking the overlay asks before closing.
  await view.getByRole('button', { name: 'Add a comment…' }).click()
  await view.getByRole('textbox', { name: 'Add a comment' }).fill('Half-written thought')
  await page.mouse.click(5, 5)
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  // Gone from the DOM (its fading overlay would still catch a click).
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(view).toBeVisible()
  await expect(view.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('Half-written thought')

  // The first Escape only leaves the editor; the second one would close the modal: it asks.
  await view.getByRole('textbox', { name: 'Add a comment' }).focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(view).toBeVisible()

  // So does the close button.
  await view.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(view).toBeVisible()

  // Opening a linked issue from inside the modal asks as well; staying keeps the draft.
  await view.getByRole('region', { name: 'Linked issues' }).getByRole('link', { name: other.key }).click()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  // Gone from the DOM (its fading overlay would still catch a click).
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(view).toHaveAttribute('data-issue-key', issue.key)
  await expect(page).toHaveURL(new RegExp(`issue=${issue.key}`))

  // Browser Back asks; discarding closes the modal.
  await page.goBack()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(view).toBeHidden()
  await expect(page).not.toHaveURL(/issue=/)

  // A description edit: Discard closes the modal and nothing is saved.
  await page.goto(`/projects/${key}/board?issue=${issue.key}`)
  await view.getByRole('button', { name: 'Add a description…' }).click()
  await view.getByRole('textbox', { name: 'Description' }).fill('Not saved')
  await page.mouse.click(5, 5)
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(view).toBeHidden()
  expect((await owner.api.issue(issue.key)).description).toBe('')

  // Nothing typed: closing needs no confirmation.
  await page.goto(`/projects/${key}/board?issue=${issue.key}`)
  await expect(view).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  await expect(discard).toHaveCount(0)
})

test('activity: an issue key is linked only where it appears whole', async ({ owner, openAs }) => {
  const key = newProjectKey('AK')
  await owner.api.createProject(key, `Keys ${key}`)
  const issues = []
  for (let i = 1; i <= 10; i++) issues.push(await owner.api.createIssue(key, { summary: `Issue ${i}` }))
  const [first] = issues
  const tenth = issues[9]
  expect(tenth.key).toBe(`${key}-10`)
  await owner.api.post(`/issues/${first.key}/links`, { type: 'blocks', targetKey: tenth.key })

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/activity`)
  const row = page.locator('[data-testid^="activity-"]').filter({ hasText: `blocks ${tenth.key}` })
  await expect(row).toHaveCount(1)
  // "linked AK…-1 blocks AK…-10": only the subject is a link, and it points at issue 1.
  const links = row.getByRole('link')
  await expect(links).toHaveCount(1)
  await expect(links).toHaveText(first.key)
  await expect(links).toHaveAttribute('href', `/browse/${first.key}`)
  await expect(row).toContainText(`linked ${first.key} blocks ${tenth.key}`)
})

test('links: inward links and removals need edit rights in the other issue’s project', async ({ owner, newUser, openAs }) => {
  const linker = await newUser('Linker')
  const mine = newProjectKey('LM')
  const theirs = newProjectKey('LV')
  await owner.api.createProject(mine, `Mine ${mine}`)
  await owner.api.createProject(theirs, `Theirs ${theirs}`)
  await owner.api.addMember(mine, linker.user.email, 'member')
  await owner.api.addMember(theirs, linker.user.email, 'viewer')
  const issue = await owner.api.createIssue(mine, { summary: 'Local issue' })
  const blocker = await owner.api.createIssue(theirs, { summary: 'Upstream blocker' })
  const target = await owner.api.createIssue(theirs, { summary: 'Link target zeta' })
  // Stored on the other project's issue: "blocker blocks issue".
  await owner.api.post(`/issues/${blocker.key}/links`, { type: 'blocks', targetKey: issue.key })

  const page = await openAs(linker)
  await page.goto(`/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  const linked = view.getByRole('region', { name: 'Linked issues' })
  await expect(linked).toContainText(blocker.key)
  // The linker only views that project: no Remove on the inward link.
  await linked.getByRole('listitem').filter({ hasText: blocker.key }).hover()
  await expect(linked.getByRole('button', { name: `Remove link to ${blocker.key}` })).toHaveCount(0)

  // "is blocked by" would be stored on the target: view-only projects are not offered.
  await linked.getByRole('button', { name: 'Link issue' }).click()
  const form = view.getByRole('group', { name: 'Link an issue' })
  await form.getByRole('combobox', { name: 'Relationship' }).selectOption({ label: 'is blocked by' })
  await expect(form.getByTestId('link-inward-hint')).toBeVisible()
  const search = page.getByPlaceholder('Search by key or summary…')
  // The issue search opens with the form; reopen it when a click elsewhere closed it.
  const openSearch = async () => {
    if (!(await search.isVisible())) await form.getByRole('button', { name: 'Issue to link' }).click()
    await expect(search).toBeVisible()
  }
  await openSearch()
  await search.fill(target.key)
  await expect(page.getByRole('listbox').last()).toContainText('No matching issues')

  // "blocks" is stored on this issue: allowed.
  await form.getByRole('combobox', { name: 'Relationship' }).selectOption({ label: 'blocks' })
  await openSearch()
  await search.fill(target.key)
  await page.getByRole('listbox').last().getByRole('option', { name: new RegExp(target.key) }).click()
  await form.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(linked.getByRole('listitem').filter({ hasText: target.key })).toBeVisible()
  expect((await owner.api.issue(issue.key)).links.map((l) => `${l.direction} ${l.label} ${l.issue.key}`).sort()).toEqual(
    [`inward is blocked by ${blocker.key}`, `outward blocks ${target.key}`].sort(),
  )
})
