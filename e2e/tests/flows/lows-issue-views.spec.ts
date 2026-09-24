import type { Page } from '@playwright/test'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { fieldControl, pickOption } from '../../support/ui.ts'

const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]').filter({ hasText: text })

test('create issue: closing after changing any field asks first, from Cancel too', async ({ owner, openAs }) => {
  const key = newProjectKey('CQ')
  await owner.api.createProject(key, `Create ${key}`)
  const page = await openAs(owner)
  await page.goto(`/projects/${key}/issues`)
  const modal = page.getByTestId('create-issue-modal')
  const discard = page.getByRole('alertdialog').filter({ hasText: 'Discard this issue?' })
  const openCreate = async () => {
    await page.getByRole('button', { name: 'Create issue' }).first().click()
    await expect(modal).toBeVisible()
  }

  // Untouched: Cancel just closes.
  await openCreate()
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(modal).toBeHidden()
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)

  // Fields other than the summary count as unsaved input for Escape…
  await openCreate()
  await fieldControl(modal, 'Priority').click()
  await pickOption(page, /^Highest$/)
  await fieldControl(modal, 'Story points').fill('8')
  await fieldControl(modal, 'Story points').press('Escape')
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(modal).toBeVisible()
  await expect(fieldControl(modal, 'Story points')).toHaveValue('8')

  // …and for the footer's Cancel, which asks like Escape does; Discard closes.
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(modal).toBeHidden()

  // A typed summary: Cancel asks too.
  await openCreate()
  await modal.getByTestId('create-issue-summary').fill('Half a thought')
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(modal.getByTestId('create-issue-summary')).toHaveValue('Half a thought')
})

test('create issue: the assignee and epic pickers are announced with their field name', async ({ owner, openAs }) => {
  const key = newProjectKey('CL')
  await owner.api.createProject(key, `Labels ${key}`)
  const epic = await owner.api.createIssue(key, { type: 'epic', summary: 'Checkout' })
  const page = await openAs(owner)
  await page.goto(`/projects/${key}/issues`)
  await page.getByRole('button', { name: 'Create issue' }).first().click()
  const modal = page.getByTestId('create-issue-modal')

  await expect(modal.getByRole('button', { name: 'Assignee: Unassigned' })).toBeVisible()
  await modal.getByRole('button', { name: 'Assign to me' }).click()
  await expect(modal.getByRole('button', { name: `Assignee: ${owner.user.name}` })).toBeVisible()

  await expect(modal.getByRole('button', { name: 'Epic: Select epic' })).toBeVisible()
  await modal.getByRole('button', { name: 'Epic: Select epic' }).click()
  await pickOption(page, new RegExp(epic.key), epic.key)
  await expect(modal.getByRole('button', { name: `Epic: ${epic.key} Checkout` })).toBeVisible()
})

test('issue modal opened from a shared ?issue= link closes in one go after moving to another issue', async ({
  owner,
  openAs,
}) => {
  const key = newProjectKey('SL')
  await owner.api.createProject(key, `Shared ${key}`, 'kanban')
  const first = await owner.api.createIssue(key, { type: 'task', summary: 'Shared first' })
  const second = await owner.api.createIssue(key, { type: 'task', summary: 'Linked second' })
  const third = await owner.api.createIssue(key, { type: 'task', summary: 'Linked third' })
  await owner.api.post(`/issues/${first.key}/links`, { type: 'relates', targetKey: second.key })
  await owner.api.post(`/issues/${second.key}/links`, { type: 'relates', targetKey: third.key })

  const page = await openAs(owner)
  const view = page.getByTestId('issue-view')
  const linked = (issueKey: string) =>
    view.getByRole('region', { name: 'Linked issues' }).getByRole('link', { name: issueKey })

  // The close button, after one move.
  await page.goto(`/projects/${key}/board?issue=${first.key}`)
  await expect(view).toHaveAttribute('data-issue-key', first.key)
  await linked(second.key).click()
  await expect(view).toHaveAttribute('data-issue-key', second.key)
  await view.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(view).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/board$`))
  await expect(page.getByTestId(`issue-card-${first.key}`)).toBeVisible()

  // Escape, after two moves.
  await page.goto(`/projects/${key}/board?issue=${first.key}`)
  await expect(view).toHaveAttribute('data-issue-key', first.key)
  await linked(second.key).click()
  await expect(view).toHaveAttribute('data-issue-key', second.key)
  await linked(third.key).click()
  await expect(view).toHaveAttribute('data-issue-key', third.key)
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/board$`))
})

test('full issue page: leaving with an unsaved comment asks first, and so does reloading', async ({ owner, openAs }) => {
  const key = newProjectKey('PD')
  await owner.api.createProject(key, `Page drafts ${key}`)
  const issue = await owner.api.createIssue(key, { type: 'task', summary: 'Write things down' })
  const other = await owner.api.createIssue(key, { type: 'task', summary: 'Another one' })
  await owner.api.post(`/issues/${issue.key}/links`, { type: 'relates', targetKey: other.key })

  const page = await openAs(owner)
  await page.goto(`/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  await expect(view).toHaveAttribute('data-issue-key', issue.key)
  const discard = page.getByRole('alertdialog').filter({ hasText: 'Discard unsaved changes?' })
  const composer = view.getByRole('textbox', { name: 'Add a comment' })
  await view.getByRole('button', { name: 'Add a comment…' }).click()
  await composer.fill('Half-written thought')

  // Reloading gets the browser's own prompt.
  const dialogs: string[] = []
  page.once('dialog', (dialog) => {
    dialogs.push(dialog.type())
    void dialog.dismiss()
  })
  await page.evaluate(() => {
    // A reload without waiting for it: dismissing the prompt cancels it.
    setTimeout(() => location.reload(), 0)
  })
  await expect.poll(() => dialogs).toEqual(['beforeunload'])
  await expect(composer).toHaveValue('Half-written thought')

  // A linked issue asks; staying keeps the draft and the page.
  const link = view.getByRole('region', { name: 'Linked issues' }).getByRole('link', { name: other.key })
  await link.click()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/browse/${issue.key}$`))
  await expect(composer).toHaveValue('Half-written thought')

  // The breadcrumb asks as well; discarding leaves.
  await view.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click()
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${key}/board$`))

  // Back to the page with nothing typed: moving to another issue needs no confirmation.
  await page.goto(`/browse/${issue.key}`)
  await expect(view).toHaveAttribute('data-issue-key', issue.key)
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/browse/${other.key}$`))
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
})

test('comments and the description give keyboard focus back when their editor closes', async ({ owner, openAs }) => {
  const key = newProjectKey('CF')
  await owner.api.createProject(key, `Comment focus ${key}`)
  const issue = await owner.api.createIssue(key, { type: 'task', summary: 'Talk it through' })
  const page = await openAs(owner)
  // In the modal, focus would otherwise fall back to the top of the dialog.
  await page.goto(`/projects/${key}/board?issue=${issue.key}`)
  const view = page.getByTestId('issue-view')
  await expect(view).toHaveAttribute('data-issue-key', issue.key)
  const addComment = view.getByRole('button', { name: 'Add a comment…' })
  const composer = view.getByRole('textbox', { name: 'Add a comment' })
  // Saved text as rendered (the editor may still hold the same text, read-only, for a moment).
  const rendered = (text: string) => view.getByRole('paragraph').filter({ hasText: text })

  // Posting with ⌘/Ctrl+Enter focuses "Add a comment…" again.
  await addComment.click()
  await composer.fill('First take')
  await composer.press('ControlOrMeta+Enter')
  await expect(rendered('First take')).toBeVisible()
  await expect(addComment).toBeFocused()

  // Escape in an empty composer, too.
  await page.keyboard.press('Enter')
  await expect(composer).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(addComment).toBeFocused()
  await expect(view).toBeVisible()

  // Saving or cancelling an edit focuses that comment's Edit button.
  const edit = view.getByRole('button', { name: 'Edit', exact: true })
  const editor = view.getByRole('textbox', { name: 'Edit comment' })
  await edit.click()
  await editor.fill('Second take')
  await editor.press('ControlOrMeta+Enter')
  await expect(rendered('Second take')).toBeVisible()
  await expect(edit).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(edit).toBeFocused()
  await expect(view).toBeVisible()

  // The description: saving focuses its Edit button.
  const section = view.getByRole('region', { name: 'Description' })
  await section.getByRole('button', { name: 'Add a description…' }).click()
  await section.getByRole('textbox', { name: 'Description' }).fill('Some context')
  await section.getByRole('textbox', { name: 'Description' }).press('ControlOrMeta+Enter')
  await expect(rendered('Some context')).toBeVisible()
  await expect(section.getByRole('button', { name: 'Edit description' })).toBeFocused()
})

test('copy link and copy issue key work where the Clipboard API is missing (plain-http LAN address)', async ({
  owner,
  openAs,
}) => {
  const key = newProjectKey('CP')
  await owner.api.createProject(key, `Copy ${key}`)
  const issue = await owner.api.createIssue(key, { type: 'task', summary: 'Share me' })
  const page = await openAs(owner)
  // Like http://<LAN address>: no navigator.clipboard. Records what the page puts on the clipboard.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    window.addEventListener('copy', (event) => {
      ;(window as unknown as { copied: string[] }).copied ??= []
      ;(window as unknown as { copied: string[] }).copied.push(event.clipboardData?.getData('text/plain') ?? '')
    })
  })
  await page.goto(`/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  await expect(view).toHaveAttribute('data-issue-key', issue.key)
  const copied = () => page.evaluate(() => (window as unknown as { copied?: string[] }).copied ?? [])

  await view.getByRole('button', { name: 'Copy link' }).click()
  await expect(toast(page, 'Link copied to clipboard')).toBeVisible()
  expect(await copied()).toEqual([new URL(`/browse/${issue.key}`, page.url()).href])

  await view.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Copy issue key' }).click()
  await expect(toast(page, 'Issue key copied to clipboard')).toBeVisible()
  expect((await copied()).at(-1)).toBe(issue.key)
})

test('create issue: a failed background refresh of the project list keeps the open form', async ({ owner, openAs }) => {
  const key = newProjectKey('CR')
  await owner.api.createProject(key, `Refresh ${key}`)
  const page = await openAs(owner)
  // Wait for the live-update socket, which carries the rename below.
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes(`/api/projects/${key}/ws`))
  await page.goto(`/projects/${key}/issues`)
  await socket
  await page.getByRole('button', { name: 'Create issue' }).first().click()
  const modal = page.getByTestId('create-issue-modal')
  await modal.getByTestId('create-issue-summary').fill('Survives a blip')

  // The project list can't be reloaded when a rename (a live project.changed) refreshes it.
  let failed = 0
  const projectList = (url: URL) => url.pathname === '/api/projects'
  await page.route(projectList, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    failed++
    await route.abort('connectionrefused')
  })
  await owner.api.patch(`/projects/${key}`, { name: `Renamed ${key}` })
  // The first attempt and both retries failed.
  await expect.poll(() => failed, { timeout: 20_000 }).toBeGreaterThanOrEqual(3)
  await page.waitForTimeout(500)

  await expect(modal.getByText('Couldn’t load your projects')).toHaveCount(0)
  await expect(modal.getByTestId('create-issue-summary')).toHaveValue('Survives a blip')
  await page.unroute(projectList)
  await modal.getByTestId('create-issue-submit').click()
  await expect(modal).toBeHidden()
  expect((await owner.api.issue(`${key}-1`)).summary).toBe('Survives a blip')
})
