import type { Page } from '@playwright/test'
import type { Session } from '../../support/api.ts'
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

/** Matches the Details tab's lookup of a project's open sprints. */
const openSprintsLookup = (key: string) => (url: URL) =>
  url.pathname === `/api/projects/${key}/sprints` && url.searchParams.get('state') === 'active,planned'

/** A Scrum project with a running sprint. */
async function scrumWithActiveSprint(owner: Session, prefix: string) {
  const key = newProjectKey(prefix)
  await owner.api.createProject(key, `Switch ${key}`)
  const sprint = await owner.api.createSprint(key, { name: 'Running sprint' })
  await owner.api.startSprint(sprint.id, isoDate(-3), isoDate(10))
  return key
}

test('switching to Kanban waits for the open-sprint lookup instead of saving without asking', async ({ owner, openAs }) => {
  const key = await scrumWithActiveSprint(owner, 'KW')
  const page = await openAs(owner)
  const patches = recordRequests(page, 'PATCH', `/api/projects/${key}`)
  // Hold the lookup, as on a slow connection.
  const held: (() => void)[] = []
  await page.route(openSprintsLookup(key), async (route) => {
    await new Promise<void>((resolve) => held.push(resolve))
    await route.continue()
  })
  await page.goto(`/projects/${key}/settings`)
  await page.getByTestId('project-type-kanban').click()
  await expect.poll(() => held.length).toBeGreaterThan(0)

  const save = page.getByTestId('project-details-save')
  await save.click()
  await expect(save).toHaveAttribute('aria-busy', 'true')
  // The fields are locked meanwhile, so the switch confirmed next is still what the form shows.
  const name = page.getByTestId('project-details-name')
  const scrum = page.getByTestId('project-type-scrum')
  await expect(name).toBeDisabled()
  await expect(scrum.getByRole('radio')).toBeDisabled()
  await scrum.click({ force: true })
  await expect(page.getByTestId('project-type-kanban').getByRole('radio')).toBeChecked()
  for (const release of held.splice(0)) release()
  const confirm = page.getByRole('alertdialog').filter({ hasText: 'Switch to Kanban with open sprints?' })
  await expect(confirm).toContainText('Running sprint (active)')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(name).toBeEnabled()
  expect(patches).toEqual([])
  expect((await owner.api.get<{ type: string }>(`/projects/${key}`)).type).toBe('scrum')

  // Saving again asks at once (the answer is known now).
  await save.click()
  await confirm.getByRole('button', { name: 'Switch to Kanban' }).click()
  await expect.poll(async () => (await owner.api.get<{ type: string }>(`/projects/${key}`)).type).toBe('kanban')
})

test('switching to Kanban still asks when the open-sprint lookup fails', async ({ owner, openAs }) => {
  const key = await scrumWithActiveSprint(owner, 'KF')
  const page = await openAs(owner)
  await page.route(openSprintsLookup(key), (route) => route.abort())
  await page.goto(`/projects/${key}/settings`)
  await page.getByTestId('project-type-kanban').click()
  await page.getByTestId('project-details-save').click()

  const confirm = page.getByRole('alertdialog').filter({ hasText: 'Couldn’t check this project for open sprints' })
  await expect(confirm).toBeVisible()
  expect((await owner.api.get<{ type: string }>(`/projects/${key}`)).type).toBe('scrum')
  await confirm.getByRole('button', { name: 'Switch to Kanban' }).click()
  await expect.poll(async () => (await owner.api.get<{ type: string }>(`/projects/${key}`)).type).toBe('kanban')
})

test('issue search: a failed refresh is flagged over the old rows, and a deleted project’s rows go', async ({
  owner,
  openAs,
}) => {
  const key = newProjectKey('RF')
  await owner.api.createProject(key, `Refresh ${key}`)
  await owner.api.createIssue(key, { summary: 'First issue' })
  await owner.api.createIssue(key, { summary: 'Second issue' })
  const page = await openAs(owner)
  await page.clock.install()
  await page.goto(`/issues?project=${key}`)
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')

  /** Lets the results go stale (after 30 s), then comes back to the tab, which refreshes them. */
  const refreshOnReturn = async () => {
    await page.clock.fastForward('00:31')
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  }

  // The server can't be reached: the rows stay, flagged as possibly out of date.
  const search = (url: URL) => url.pathname === '/api/issues'
  await page.route(search, (route) => route.abort())
  await refreshOnReturn()
  const stale = page.getByTestId('issues-refresh-error')
  await expect(stale).toContainText('Couldn’t refresh issues')
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  await page.unroute(search)
  await stale.getByRole('button', { name: 'Try again' }).click()
  await expect(stale).toBeHidden()
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')

  // The project is deleted: its rows go, and the project filter can be cleared.
  await owner.api.delete(`/projects/${key}`)
  await refreshOnReturn()
  const error = page.getByTestId('issues-error')
  await expect(error).toContainText('Project not found')
  await expect(page.getByTestId('issues-table')).toHaveCount(0)
  await error.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL(/\/issues$/)
  await expect(page.getByTestId('issues-empty')).toBeVisible()
})

test('issue search: a category + status link to a project you can’t see says so instead of loading forever', async ({
  owner,
  newUser,
  openAs,
}) => {
  const key = newProjectKey('MX')
  await owner.api.createProject(key, `Mixed ${key}`)
  const [todo] = await owner.api.statuses(key)
  const stranger = await newUser('Stranger')

  const page = await openAs(stranger)
  await page.goto(`/issues?project=${key}&category=done&status=${todo.id}`)
  const error = page.getByTestId('issues-error')
  await expect(error).toContainText('Couldn’t load issues')
  await expect(error).toContainText('Project not found')
  await expect(page.getByTestId('issues-table')).toHaveCount(0)
  await error.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).toHaveURL(/\/issues$/)
  await expect(page.getByTestId('issues-empty')).toBeVisible()
})

test('names with emoji: length limits count characters, as the server does', async ({ owner, openAs }) => {
  const fire = '🔥' // one character, two UTF-16 units
  const key = newProjectKey('EM')
  await owner.api.createProject(key, fire.repeat(50))
  await owner.api.createIssue(key, { summary: 'Existing issue' })
  const page = await openAs(owner)
  const patches = recordRequests(page, 'PATCH', `/api/projects/${key}`)
  const saved = () => owner.api.get<{ name: string; description: string }>(`/projects/${key}`)

  // The saved name is 50 of the 80 characters: a description-only change saves.
  await page.goto(`/projects/${key}/settings`)
  const name = page.getByTestId('project-details-name')
  await expect(name).toHaveValue(fire.repeat(50))
  await page.getByRole('textbox', { name: 'Description' }).fill('Only the description')
  await page.getByTestId('project-details-save').click()
  await expect.poll(async () => (await saved()).description).toBe('Only the description')
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ description: 'Only the description' }])

  // The name stops at 80 characters of any kind.
  await name.fill('a'.repeat(81))
  await expect(name).toHaveValue('a'.repeat(80))
  await name.fill(fire.repeat(81))
  await expect(name).toHaveValue(fire.repeat(80))
  await page.getByTestId('project-details-save').click()
  await expect.poll(async () => (await saved()).name).toBe(fire.repeat(80))

  // Label names take 40 emoji.
  await page.goto(`/projects/${key}/settings?tab=labels`)
  const labelName = page.getByTestId('create-label-name')
  await labelName.fill(fire.repeat(41))
  await expect(labelName).toHaveValue(fire.repeat(40))
  await labelName.press('Enter')
  await expect
    .poll(async () => (await owner.api.get<{ name: string }[]>(`/projects/${key}/labels`)).map((l) => l.name))
    .toEqual([fire.repeat(40)])

  // Summaries take 200 emoji (up to 255 characters).
  await page.goto(`/projects/${key}/issues`)
  await page.getByTestId('nav-create-issue').click()
  const modal = page.getByTestId('create-issue-modal')
  await modal.getByTestId('create-issue-summary').fill(fire.repeat(200))
  await expect(modal.getByTestId('create-issue-summary')).toHaveValue(fire.repeat(200))
  await modal.getByTestId('create-issue-submit').click()
  await expect(modal).toBeHidden()
  const latest = await owner.api.get<{ items: { summary: string }[] }>(`/issues?project=${key}&sort=created&limit=1`)
  expect(latest.items.map((i) => i.summary)).toEqual([fire.repeat(200)])
})

test('text typed with an input method (IME) is cut to the limit when it is committed', async ({ owner, openAs }) => {
  const key = newProjectKey('IM')
  await owner.api.createProject(key, `IME ${key}`)
  const page = await openAs(owner)
  const cdp = await page.context().newCDPSession(page)
  /** Types にほん with a Japanese IME into the focused field and commits it as 日本語. */
  const composeNihongo = async () => {
    for (const text of ['に', 'にほ', 'にほん']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
    }
    await cdp.send('Input.insertText', { text: '日本語' })
  }

  // A label name (40 characters) two short of the limit keeps two of the three.
  await page.goto(`/projects/${key}/settings?tab=labels`)
  const labelName = page.getByTestId('create-label-name')
  await labelName.fill('a'.repeat(38))
  await composeNihongo()
  await expect(labelName).toHaveValue(`${'a'.repeat(38)}日本`)
  await labelName.press('Enter')
  await expect
    .poll(async () => (await owner.api.get<{ name: string }[]>(`/projects/${key}/labels`)).map((l) => l.name))
    .toEqual([`${'a'.repeat(38)}日本`])

  // So does a project description (4000 characters), and the save sends the cut text.
  await page.goto(`/projects/${key}/settings`)
  const description = page.getByRole('textbox', { name: 'Description' })
  await description.fill('d'.repeat(3998))
  await composeNihongo()
  await expect(description).toHaveValue(`${'d'.repeat(3998)}日本`)
  await page.getByTestId('project-details-save').click()
  await expect
    .poll(async () => (await owner.api.get<{ description: string }>(`/projects/${key}`)).description)
    .toBe(`${'d'.repeat(3998)}日本`)
})

test('create project: the suggested key keeps accented letters in their word', async ({ owner, openAs }) => {
  const page = await openAs(owner)
  await page.goto('/projects')
  await page.getByTestId('projects-create').click()
  const dialog = page.getByTestId('create-project-dialog')
  const name = dialog.getByTestId('create-project-name')
  const key = dialog.getByTestId('create-project-key')
  for (const [typed, suggested] of [
    ['Müller Projekt', 'MP'],
    ['São Paulo Ops', 'SPO'],
    ['Straße Planung', 'SP'],
    ['Équipe', 'EQUI'],
  ]) {
    await name.fill(typed)
    await expect(key).toHaveValue(suggested)
  }
})
