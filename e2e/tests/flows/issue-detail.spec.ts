import type { Locator } from '@playwright/test'
import { ALEX } from '../../support/env.ts'
import { expect, newProjectKey, test, uid } from '../../support/fixtures.ts'
import { pickOption } from '../../support/ui.ts'

/** Waits until no detail field shows its "Saving …" spinner. */
async function settled(view: Locator) {
  await expect(view.getByRole('status', { name: /^Saving / })).toHaveCount(0)
}

test('issue modal: edit every field, comment, link, read the history, open the full page', async ({ owner, openAs }) => {
  const key = newProjectKey('IS')
  await owner.api.createProject(key, `Issues ${key}`)
  await owner.api.addMember(key, ALEX.email, 'member')
  const issue = await owner.api.createIssue(key, { type: 'story', summary: 'Original summary' })
  const other = await owner.api.createIssue(key, { type: 'bug', summary: 'Crash when saving drafts' })
  const labelName = `ux-${uid(4).toLowerCase()}`

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/backlog?issue=${issue.key}`)
  const view = page.getByTestId('issue-view')
  await expect(view).toHaveAttribute('data-issue-key', issue.key)
  await expect(page.getByRole('dialog')).toBeVisible()

  // --- summary (inline edit, Enter saves)
  await view.getByTestId('issue-summary').click()
  await view.getByTestId('issue-summary').fill('Checkout supports saved cards')
  await view.getByTestId('issue-summary').press('Enter')
  await expect(view.getByTestId('issue-summary')).toHaveText('Checkout supports saved cards')
  await expect.poll(async () => (await owner.api.issue(issue.key)).summary).toBe('Checkout supports saved cards')

  // --- description (Markdown editor, Save)
  await view.getByRole('button', { name: 'Add a description…' }).click()
  await view.getByRole('textbox', { name: 'Description' }).fill('Customers can pay with a **saved card**.\n\n- Visa\n- Mastercard')
  await view.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(view.locator('strong', { hasText: 'saved card' })).toBeVisible()
  await expect(view.getByRole('listitem').filter({ hasText: 'Mastercard' })).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(issue.key)).description).toContain('**saved card**')

  // --- priority
  await view.getByRole('button', { name: 'Priority: Medium' }).click()
  await pickOption(page, /^High$/)
  await expect(view.getByRole('button', { name: 'Priority: High' })).toBeVisible()
  await settled(view)
  await expect.poll(async () => (await owner.api.issue(issue.key)).priority).toBe('high')

  // --- assignee (search people)
  await view.getByRole('button', { name: 'Assignee: Unassigned' }).click()
  await pickOption(page, new RegExp(ALEX.name), 'Alex')
  await expect(view.getByRole('button', { name: `Assignee: ${ALEX.name}` })).toBeVisible()
  await settled(view)
  await expect.poll(async () => (await owner.api.issue(issue.key)).assignee?.email).toBe(ALEX.email)

  // --- labels: create one inline; the picker commits when it closes
  await view.getByRole('button', { name: 'Labels: none' }).click()
  await page.getByRole('combobox', { name: 'Search or create labels…' }).fill(labelName)
  await page.getByRole('option', { name: `Create “${labelName}”` }).click()
  await expect(page.getByRole('option', { name: labelName, exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(view.getByRole('button', { name: `Labels: ${labelName}` })).toBeVisible()
  await settled(view)
  await expect.poll(async () => (await owner.api.issue(issue.key)).labels.map((l) => l.name)).toEqual([labelName])
  // The modal is still open: Escape only closed the picker.
  await expect(view).toBeVisible()

  // --- story points
  await view.getByRole('button', { name: /^Story points/ }).click()
  await view.getByRole('spinbutton', { name: 'Story points' }).fill('5')
  await view.getByRole('spinbutton', { name: 'Story points' }).press('Enter')
  await expect(view.getByRole('button', { name: /^Story points: 5/ })).toBeVisible()
  await settled(view)
  await expect.poll(async () => (await owner.api.issue(issue.key)).storyPoints).toBe(5)

  // --- comment
  await view.getByRole('button', { name: 'Add a comment…' }).click()
  await view.getByRole('textbox', { name: 'Add a comment' }).fill('Looks good — shipping behind a flag.')
  await view.getByRole('textbox', { name: 'Add a comment' }).press('ControlOrMeta+Enter')
  await expect(view.getByText('Looks good — shipping behind a flag.')).toBeVisible()
  await expect.poll(async () => (await owner.api.get<unknown[]>(`/issues/${issue.key}/comments`)).length).toBe(1)

  // --- link to the other issue ("blocks")
  await view.getByRole('button', { name: 'Link issue' }).first().click()
  const linkForm = view.getByRole('group', { name: 'Link an issue' })
  await expect(linkForm).toBeVisible()
  await linkForm.getByLabel('Relationship').selectOption({ label: 'blocks' })
  // The issue search opens with the form; pick the bug by key.
  const search = page.getByRole('combobox', { name: 'Search by key or summary…' })
  if (!(await search.isVisible())) await linkForm.getByRole('button', { name: 'Issue to link' }).click()
  await search.fill(other.key)
  await page.getByRole('option', { name: new RegExp(other.key) }).click()
  await linkForm.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(linkForm).toBeHidden()
  const linkedSection = view.getByRole('region', { name: 'Linked issues' })
  await expect(linkedSection).toContainText('blocks')
  await expect(linkedSection).toContainText(other.key)
  const detail = await owner.api.issue(issue.key)
  expect(detail.links).toEqual([expect.objectContaining({ type: 'blocks', direction: 'outward', issue: expect.objectContaining({ key: other.key }) })])

  // --- History tells the story as sentences
  await view.getByRole('tab', { name: 'History' }).click()
  const history = view.getByRole('tabpanel')
  const me = owner.user.name
  for (const sentence of [
    `${me} changed Summary from “Original summary” to “Checkout supports saved cards”`,
    `${me} updated the Description`,
    `${me} changed Priority from Medium to High`,
    `${me} assigned the issue to ${ALEX.name}`,
    `${me} set Labels to ${labelName}`,
    `${me} set Story points to 5`,
    `${me} added link: blocks ${other.key}`,
    `${me} created the issue`,
  ]) {
    await expect(history.getByText(sentence, { exact: false })).toBeVisible()
  }

  // --- the linked bug shows the inward side
  const otherDetail = await owner.api.issue(other.key)
  expect(otherDetail.links).toEqual([expect.objectContaining({ label: 'is blocked by', issue: expect.objectContaining({ key: issue.key }) })])

  // --- open in the full page
  await view.getByRole('link', { name: 'Open in full page' }).click()
  await expect(page).toHaveURL(new RegExp(`/browse/${issue.key}$`))
  const pageView = page.getByTestId('issue-view')
  await expect(pageView.getByRole('heading', { level: 1 })).toHaveText('Checkout supports saved cards')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(pageView.getByRole('button', { name: `Assignee: ${ALEX.name}` })).toBeVisible()
  await expect(pageView.getByRole('button', { name: `Labels: ${labelName}` })).toBeVisible()
  await expect(pageView.getByText('Looks good — shipping behind a flag.')).toBeVisible()
  // …and it survives a reload.
  await page.reload()
  await expect(page.getByTestId('issue-view').getByRole('heading', { level: 1 })).toHaveText('Checkout supports saved cards')
})
