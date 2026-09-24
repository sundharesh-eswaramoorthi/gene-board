import type { Page } from '@playwright/test'
import type { Label } from '../../support/api.ts'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate } from '../../support/ui.ts'

/** Records the bodies of API requests matching `method` and a path prefix. */
function recordRequests(page: Page, method: string, pathPrefix: string): string[] {
  const bodies: string[] = []
  page.on('request', (req) => {
    if (req.method() === method && new URL(req.url()).pathname.startsWith(pathPrefix)) bodies.push(req.postData() ?? '')
  })
  return bodies
}

/**
 * Waits until every request the page has already made is recorded: the browser reports requests
 * in the order it makes them, and this one is made after them.
 */
async function requestsRecorded(page: Page) {
  await page.evaluate(() => fetch('/api/health').then((res) => res.ok))
}

/** Opens `path` and waits until its live-update socket for project `key` is connected. */
async function openLive(page: Page, key: string, path: string) {
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes(`/api/projects/${key}/ws`))
  await page.goto(path)
  await socket
  await page.waitForTimeout(300)
}

// Someone else saves a field while this user has its editor open. Leaving an untouched editor
// must not write the old value back; a real edit is kept and the change is pointed out.

test('concurrent edits: an untouched summary editor keeps a teammate’s rename', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('CE')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, 'member')
  const issue = await owner.api.createIssue(key, { summary: 'Original summary' })

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/issues/${issue.key}`)
  await openLive(page, key, `/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  const summary = view.getByTestId('issue-summary')
  await expect(summary).toHaveText('Original summary')

  // Opened but untouched: it follows the owner's rename, and clicking away saves nothing.
  await summary.click()
  await expect(summary).toHaveValue('Original summary')
  await owner.api.patch(`/issues/${issue.key}`, { summary: 'Renamed by the owner' })
  await expect(summary).toHaveValue('Renamed by the owner')
  await view.getByRole('heading', { name: 'Description', exact: true }).click()
  await expect(summary).toHaveText('Renamed by the owner')
  await requestsRecorded(page)
  expect(patches).toEqual([])
  expect((await owner.api.issue(issue.key)).summary).toBe('Renamed by the owner')

  // A real edit keeps the draft (and focus) and says what changed; Escape keeps theirs.
  await summary.click()
  await summary.fill('Renamed by the mate')
  await owner.api.patch(`/issues/${issue.key}`, { summary: 'Renamed again by the owner' })
  const notice = view.getByRole('status').filter({ hasText: 'Someone else changed this to “Renamed again by the owner”' })
  await expect(notice).toBeVisible()
  await expect(summary).toHaveValue('Renamed by the mate')
  await expect(summary).toBeFocused()
  await summary.press('Escape')
  await expect(summary).toHaveText('Renamed again by the owner')
  await expect(notice).toHaveCount(0)
  await requestsRecorded(page)
  expect(patches).toEqual([])
})

test('concurrent edits: a summary being typed never jumps to a teammate’s rename', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('CT')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, 'member')
  const issue = await owner.api.createIssue(key, { summary: 'Fix login' })

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/issues/${issue.key}`)
  await openLive(page, key, `/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  const summary = view.getByTestId('issue-summary')
  await expect(summary).toHaveText('Fix login')

  await summary.click()
  await summary.press('End')
  await page.keyboard.type(' pgae')
  await owner.api.patch(`/issues/${issue.key}`, { summary: 'Fix signup' })
  const notice = view.getByRole('status').filter({ hasText: 'Someone else changed this to “Fix signup”' })
  await expect(notice).toBeVisible()
  // Backspacing to the original text (plus a space) keeps the draft and the notice.
  for (let i = 0; i < 4; i++) await summary.press('Backspace')
  await expect(summary).toHaveValue('Fix login ')
  await expect(notice).toBeVisible()
  await page.keyboard.type('page')
  await expect(summary).toHaveValue('Fix login page')
  await summary.press('Enter')
  await expect(summary).toHaveText('Fix login page')
  await expect.poll(async () => (await owner.api.issue(issue.key)).summary).toBe('Fix login page')
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ summary: 'Fix login page' }])
})

test('concurrent edits: after following a teammate’s change, the first keystroke still replaces the text', async ({
  owner,
  newUser,
  openAs,
}) => {
  const key = newProjectKey('CR')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, 'member')
  const issue = await owner.api.createIssue(key, { type: 'story', summary: 'Original summary', storyPoints: 3 })

  const page = await openAs(mate)
  await openLive(page, key, `/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')

  // Opening an editor selects its text; it stays selected when the owner's change comes in.
  const summary = view.getByTestId('issue-summary')
  await summary.click()
  await owner.api.patch(`/issues/${issue.key}`, { summary: 'Renamed by the owner' })
  await expect(summary).toHaveValue('Renamed by the owner')
  await page.keyboard.type('Retitled')
  await expect(summary).toHaveValue('Retitled')
  await summary.press('Escape')
  await expect(summary).toHaveText('Renamed by the owner')

  await view.getByRole('button', { name: /^Story points: 3/ }).click()
  const points = view.getByRole('spinbutton', { name: 'Story points' })
  await owner.api.patch(`/issues/${issue.key}`, { storyPoints: 8 })
  await expect(points).toHaveValue('8')
  await page.keyboard.type('5')
  await expect(points).toHaveValue('5')
  await points.press('Escape')
  await expect(view.getByRole('button', { name: /^Story points: 8/ })).toBeVisible()
  expect((await owner.api.issue(issue.key)).storyPoints).toBe(8)
})

test('concurrent edits: an untouched description editor keeps a teammate’s rewrite and asks nothing', async ({
  owner,
  newUser,
  openAs,
}) => {
  const key = newProjectKey('CD')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, 'member')
  const issue = await owner.api.createIssue(key, { summary: 'Document me', description: 'Original description' })

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/issues/${issue.key}`)
  await openLive(page, key, `/projects/${key}/board?issue=${issue.key}`)
  const view = page.getByTestId('issue-view')
  const section = view.getByRole('region', { name: 'Description' })
  const editor = section.getByRole('textbox', { name: 'Description' })
  await expect(section.getByText('Original description')).toBeVisible()

  // Untouched: the editor follows the owner's rewrite, and Save writes nothing back.
  await section.getByRole('button', { name: 'Edit description' }).click()
  await expect(editor).toHaveValue('Original description')
  await owner.api.patch(`/issues/${issue.key}`, { description: 'Rewritten by the owner' })
  await expect(editor).toHaveValue('Rewritten by the owner')
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(section.getByText('Rewritten by the owner')).toBeVisible()

  // Untouched, then Escape: there is nothing to discard, so no question.
  await section.getByRole('button', { name: 'Edit description' }).click()
  await owner.api.patch(`/issues/${issue.key}`, { description: 'Rewritten twice by the owner' })
  await expect(editor).toHaveValue('Rewritten twice by the owner')
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0)
  await expect(section.getByText('Rewritten twice by the owner')).toBeVisible()

  // A real edit is kept, with a note that the description changed; Cancel keeps theirs.
  await section.getByRole('button', { name: 'Edit description' }).click()
  await editor.fill('The mate’s version')
  await owner.api.patch(`/issues/${issue.key}`, { description: 'The owner’s version' })
  await expect(section.getByRole('status').filter({ hasText: 'Someone else updated the description' })).toBeVisible()
  await expect(editor).toHaveValue('The mate’s version')
  await section.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(section.getByText('The owner’s version')).toBeVisible()

  // Untouched with the modal closed: no "Discard unsaved changes?" either.
  await section.getByRole('button', { name: 'Edit description' }).click()
  await owner.api.patch(`/issues/${issue.key}`, { description: 'Final words by the owner' })
  await expect(editor).toHaveValue('Final words by the owner')
  await view.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(view).toBeHidden()
  await expect(page.getByRole('alertdialog').filter({ hasText: 'Discard unsaved changes?' })).toHaveCount(0)
  await requestsRecorded(page)
  expect(patches).toEqual([])
  expect((await owner.api.issue(issue.key)).description).toBe('Final words by the owner')
})

test('concurrent edits: untouched story points and due date editors keep a teammate’s values', async ({
  owner,
  newUser,
  openAs,
}) => {
  const key = newProjectKey('CP')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, 'member')
  const due = isoDate(10)
  const newDue = isoDate(20)
  const issue = await owner.api.createIssue(key, { type: 'story', summary: 'Estimate me', storyPoints: 3, dueDate: due })

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/issues/${issue.key}`)
  await openLive(page, key, `/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  const points = view.getByRole('spinbutton', { name: 'Story points' })

  // Story points, untouched: follows the owner's estimate; clicking away saves nothing.
  await view.getByRole('button', { name: /^Story points: 3/ }).click()
  await expect(points).toHaveValue('3')
  await owner.api.patch(`/issues/${issue.key}`, { storyPoints: 8 })
  await expect(points).toHaveValue('8')
  await view.getByRole('heading', { name: 'Description', exact: true }).click()
  await expect(view.getByRole('button', { name: /^Story points: 8/ })).toBeVisible()
  await requestsRecorded(page)
  expect(patches).toEqual([])
  expect((await owner.api.issue(issue.key)).storyPoints).toBe(8)

  // A real edit is kept and flagged; Enter then saves it on purpose.
  await view.getByRole('button', { name: /^Story points: 8/ }).click()
  await points.fill('5')
  await owner.api.patch(`/issues/${issue.key}`, { storyPoints: 13 })
  await expect(view.getByRole('status').filter({ hasText: 'Someone else changed this to 13.' })).toBeVisible()
  await expect(points).toHaveValue('5')
  await points.press('Enter')
  await expect(view.getByRole('button', { name: /^Story points: 5/ })).toBeVisible()
  await expect.poll(async () => (await owner.api.issue(issue.key)).storyPoints).toBe(5)
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ storyPoints: 5 }])

  // Due date, untouched: follows the owner's date; Enter saves nothing.
  await view.getByRole('button', { name: /^Due date/ }).click()
  const date = view.getByLabel('Due date', { exact: true }).and(view.locator('input'))
  await expect(date).toHaveValue(due)
  await owner.api.patch(`/issues/${issue.key}`, { dueDate: newDue })
  await expect(date).toHaveValue(newDue)
  await date.press('Enter')
  await expect(date).toHaveCount(0)
  await requestsRecorded(page)
  expect(patches).toHaveLength(1)
  expect((await owner.api.issue(issue.key)).dueDate).toBe(newDue)
})

test('concurrent edits: an untouched column name editor keeps another admin’s rename', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('CC')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Admin')
  await owner.api.addMember(key, mate.user.email, 'admin')
  const todo = (await owner.api.statuses(key)).find((s) => s.name === 'To Do')!

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/projects/${key}/statuses/`)
  await openLive(page, key, `/projects/${key}/settings?tab=columns`)

  await page.getByRole('button', { name: 'Edit column name: To Do' }).click()
  const name = page.getByRole('textbox', { name: 'Column name' })
  await expect(name).toHaveValue('To Do')
  await owner.api.patch(`/projects/${key}/statuses/${todo.id}`, { name: 'Ready' })
  await expect(name).toHaveValue('Ready')
  await name.press('Tab')
  await expect(page.getByRole('button', { name: 'Edit column name: Ready' })).toBeVisible()
  await requestsRecorded(page)
  expect(patches).toEqual([])
  expect((await owner.api.statuses(key)).find((s) => s.id === todo.id)?.name).toBe('Ready')
})

test('concurrent edits: a WIP limit follows another admin’s limit until the admin types', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('CW')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Admin')
  await owner.api.addMember(key, mate.user.email, 'admin')
  const todo = (await owner.api.statuses(key)).find((s) => s.name === 'To Do')!
  const setLimit = (wipLimit: number) => owner.api.patch(`/projects/${key}/statuses/${todo.id}`, { wipLimit })
  const savedLimit = async () => (await owner.api.statuses(key)).find((s) => s.id === todo.id)?.wipLimit

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/projects/${key}/statuses/`)
  await openLive(page, key, `/projects/${key}/settings?tab=columns`)
  const wip = page.getByRole('spinbutton', { name: 'WIP limit of To Do' })
  await expect(wip).toHaveValue('')

  // Focused but untouched: it takes the owner's limit (keeping focus), and leaving saves nothing.
  await wip.click()
  await setLimit(3)
  await expect(wip).toHaveValue('3')
  await expect(wip).toBeFocused()
  await wip.press('Tab')
  await requestsRecorded(page)
  expect(patches).toEqual([])

  // A typed limit is kept (with focus) and the change is pointed out; Escape keeps theirs.
  await wip.click()
  await wip.fill('5')
  await setLimit(4)
  const notice = page.getByRole('status').filter({ hasText: 'Someone else changed the WIP limit to 4.' })
  await expect(notice).toBeVisible()
  await expect(wip).toHaveValue('5')
  await expect(wip).toBeFocused()
  await wip.press('Escape')
  await expect(wip).toHaveValue('4')
  await expect(notice).toHaveCount(0)
  await requestsRecorded(page)
  expect(patches).toEqual([])
  expect(await savedLimit()).toBe(4)

  // Enter on a typed limit replaces theirs on purpose.
  await wip.click()
  await wip.fill('6')
  await setLimit(2)
  await expect(page.getByRole('status').filter({ hasText: 'Someone else changed the WIP limit to 2.' })).toBeVisible()
  await wip.press('Enter')
  await expect.poll(savedLimit).toBe(6)
  await expect(wip).toHaveValue('6')
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ wipLimit: 6 }])
})

test('concurrent edits: the labels picker only changes the labels picked in it', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('CL')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Mate')
  await owner.api.addMember(key, mate.user.email, 'member')
  const [alpha, beta, gamma] = await Promise.all(
    ['alpha', 'beta', 'gamma'].map((name) => owner.api.post<Label>(`/projects/${key}/labels`, { name })),
  )
  const issue = await owner.api.createIssue(key, { summary: 'Label me', labelIds: [alpha.id] })
  const labelNames = async () => (await owner.api.issue(issue.key)).labels.map((l) => l.name)

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/issues/${issue.key}`)
  await openLive(page, key, `/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  const option = (name: string) => page.getByRole('option', { name, exact: true })

  // Opened but untouched: it shows the owner's new label, and closing saves nothing.
  await view.getByRole('button', { name: 'Labels: alpha' }).click()
  await expect(option('alpha')).toHaveAttribute('aria-selected', 'true')
  await owner.api.patch(`/issues/${issue.key}`, { labelIds: [alpha.id, beta.id] })
  await expect(option('beta')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(view.getByRole('button', { name: 'Labels: alpha, beta' })).toBeVisible()
  await requestsRecorded(page)
  expect(patches).toEqual([])
  expect(await labelNames()).toEqual(['alpha', 'beta'])

  // Picking one applies to the live labels: the owner's removal meanwhile stays.
  await view.getByRole('button', { name: 'Labels: alpha, beta' }).click()
  await option('gamma').click()
  await expect(option('gamma')).toHaveAttribute('aria-selected', 'true')
  await owner.api.patch(`/issues/${issue.key}`, { labelIds: [beta.id] })
  await expect(option('alpha')).toHaveAttribute('aria-selected', 'false')
  await page.keyboard.press('Escape')
  await expect(view.getByRole('button', { name: 'Labels: beta, gamma' })).toBeVisible()
  await expect.poll(labelNames).toEqual(['beta', 'gamma'])
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ labelIds: [beta.id, gamma.id] }])

  // A label checked and unchecked again is no pick: the owner adding it meanwhile stays.
  await view.getByRole('button', { name: 'Labels: beta, gamma' }).click()
  await option('alpha').click()
  await expect(option('alpha')).toHaveAttribute('aria-selected', 'true')
  await option('alpha').click()
  await expect(option('alpha')).toHaveAttribute('aria-selected', 'false')
  await owner.api.patch(`/issues/${issue.key}`, { labelIds: [alpha.id, beta.id, gamma.id] })
  await expect(option('alpha')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(view.getByRole('button', { name: 'Labels: alpha, beta, gamma' })).toBeVisible()
  await requestsRecorded(page)
  expect(patches).toHaveLength(1)
  expect(await labelNames()).toEqual(['alpha', 'beta', 'gamma'])
})

test('concurrent edits: saving project details keeps the fields another admin changed', async ({ owner, newUser, openAs }) => {
  const key = newProjectKey('CS')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Admin')
  await owner.api.addMember(key, mate.user.email, 'admin')
  const saved = () => owner.api.get<{ name: string; description: string }>(`/projects/${key}`)

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/projects/${key}`)
  await openLive(page, key, `/projects/${key}/settings`)
  const name = page.getByTestId('project-details-name')
  const description = page.getByRole('textbox', { name: 'Description' })
  await expect(name).toHaveValue(`Concurrent ${key}`)

  // The admin writes a description while the owner renames the project and rewrites it: the
  // untouched name follows, the typed description is kept, and Save sends only the description.
  await description.fill('Written by the admin')
  await owner.api.patch(`/projects/${key}`, { name: 'Renamed by the owner', description: 'Written by the owner' })
  await expect(name).toHaveValue('Renamed by the owner')
  await expect(description).toHaveValue('Written by the admin')
  await page.getByTestId('project-details-save').click()
  await expect.poll(async () => (await saved()).description).toBe('Written by the admin')
  expect((await saved()).name).toBe('Renamed by the owner')
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ description: 'Written by the admin' }])
})

test('concurrent edits: project details still follow another admin after saving text with extra spaces', async ({
  owner,
  newUser,
  openAs,
}) => {
  const key = newProjectKey('CX')
  await owner.api.createProject(key, `Concurrent ${key}`)
  const mate = await newUser('Admin')
  await owner.api.addMember(key, mate.user.email, 'admin')
  const saved = () => owner.api.get<{ name: string; description: string }>(`/projects/${key}`)

  const page = await openAs(mate)
  const patches = recordRequests(page, 'PATCH', `/api/projects/${key}`)
  await openLive(page, key, `/projects/${key}/settings`)
  const name = page.getByTestId('project-details-name')
  const description = page.getByRole('textbox', { name: 'Description' })
  await expect(name).toHaveValue(`Concurrent ${key}`)

  // The server trims the saved name, so the trailing space typed here is no edit any more.
  await name.fill('Named by the admin ')
  await page.getByTestId('project-details-save').click()
  await expect.poll(async () => (await saved()).name).toBe('Named by the admin')

  // The owner's rename is taken, and saving a description later does not write the old name back.
  await owner.api.patch(`/projects/${key}`, { name: 'Renamed by the owner' })
  await expect(name).toHaveValue('Renamed by the owner')
  await description.fill('Written by the admin')
  await page.getByTestId('project-details-save').click()
  await expect.poll(async () => (await saved()).description).toBe('Written by the admin')
  expect((await saved()).name).toBe('Renamed by the owner')
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ name: 'Named by the admin' }, { description: 'Written by the admin' }])
})
