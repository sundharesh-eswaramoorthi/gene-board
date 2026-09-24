import type { Locator, Page } from '@playwright/test'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate, testIdKeys } from '../../support/ui.ts'

/** Row keys of the results table, sorted. */
const rowKeys = async (page: Page) => (await testIdKeys(page.getByTestId('issues-table'), 'issue-row-')).sort()

/** Picks `option` in the filter menu labelled `label`, then closes the menu. */
async function pickFilter(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('button', { name: new RegExp(`^${label} filter`) }).click()
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: option }).click()
  await page.keyboard.press('Escape')
}

/**
 * True when nothing is drawn over `locator`: the points at its centre and just inside its left
 * and right edges all hit-test to it (or its content).
 */
async function takesTaps(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const y = r.top + r.height / 2
    return [r.left + 4, r.left + r.width / 2, r.right - 4].every((x) => {
      const hit = document.elementFromPoint(x, y)
      return hit != null && el.contains(hit)
    })
  })
}

test('Kanban issue search never applies a sprint filter out of sight', async ({ owner, openAs }) => {
  // A Scrum project with a running sprint, then switched to Kanban: the sprint is left over.
  const switched = newProjectKey('KW')
  await owner.api.createProject(switched, `Switched ${switched}`)
  const sprint = await owner.api.createSprint(switched, { name: 'Leftover sprint' })
  const inSprint = [
    await owner.api.createIssue(switched, { summary: 'Leftover sprint work A', sprintId: sprint.id }),
    await owner.api.createIssue(switched, { summary: 'Leftover sprint work B', sprintId: sprint.id }),
  ]
  const outside = await owner.api.createIssue(switched, { summary: 'Never in a sprint' })
  await owner.api.startSprint(sprint.id, isoDate(-2), isoDate(12))
  await owner.api.patch(`/projects/${switched}`, { type: 'kanban' })
  // A project that has been Kanban from the start.
  const kanban = newProjectKey('KN')
  await owner.api.createProject(kanban, `Kanban ${kanban}`, 'kanban')
  const flow = [
    await owner.api.createIssue(kanban, { summary: 'Flow item 1' }),
    await owner.api.createIssue(kanban, { summary: 'Flow item 2' }),
    await owner.api.createIssue(kanban, { summary: 'Flow item 3' }),
  ]
  const sprintMenu = (page: Page) => page.getByRole('button', { name: /^Sprint filter/ })

  const page = await openAs(owner)

  // Kanban projects plan without sprints: no Sprint menu, every issue listed.
  await page.goto(`/projects/${kanban}/issues`)
  await expect(page.getByTestId('issues-count')).toHaveText('3 issues')
  await expect(sprintMenu(page)).toHaveCount(0)

  // A bookmarked sprint filter still narrows the switched project's issues, so it shows…
  await page.goto(`/projects/${switched}/issues?sprint=active&resolved=false`)
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  await expect.poll(() => rowKeys(page)).toEqual(inSprint.map((i) => i.key).sort())
  await expect(sprintMenu(page)).toHaveAccessibleName('Sprint filter: 1 selected')
  await expect(sprintMenu(page)).toContainText('Sprint: Active sprint')
  // …and can be removed on its own, keeping the other filters.
  await sprintMenu(page).click()
  await page.getByRole('button', { name: 'Clear sprint' }).click()
  await expect(page).not.toHaveURL(/[?&]sprint=/)
  await expect(page).toHaveURL(/[?&]resolved=false/)
  await expect(page.getByTestId('issues-count')).toHaveText('3 issues')
  await expect.poll(() => rowKeys(page)).toEqual([...inSprint.map((i) => i.key), outside.key].sort())
  await expect(page.getByRole('button', { name: 'Resolution filter: 1 selected' })).toBeVisible()
  // The emptied menu stays while the page shows this project, so closing it hands focus back
  // to its button rather than dropping it to the page.
  await expect(sprintMenu(page)).toHaveAccessibleName('Sprint filter')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', { name: 'Sprint' })).toBeHidden()
  await expect(sprintMenu(page)).toBeFocused()
  // Selecting the chosen sprint again from the keyboard clears it too, keeping focus the same way.
  await page.goto(`/projects/${switched}/issues?sprint=active`)
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  await sprintMenu(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox', { name: 'Sprint' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).not.toHaveURL(/[?&]sprint=/)
  await expect(page.getByTestId('issues-count')).toHaveText('3 issues')
  await expect(sprintMenu(page)).toBeFocused()
  // Opened afresh, the project has no sprint to show and no Sprint menu.
  await page.reload()
  await expect(page.getByTestId('issues-count')).toHaveText('3 issues')
  await expect(sprintMenu(page)).toHaveCount(0)

  // Same on /issues with a shared link to a Kanban project and a sprint (checked once the
  // project list, and with it the project's type, has loaded).
  await page.goto(`/issues?project=${switched}&sprint=active`)
  await expect(page.getByRole('button', { name: /^Project filter/ })).toContainText(`Switched ${switched}`)
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  await expect(sprintMenu(page)).toHaveAccessibleName('Sprint filter: 1 selected')

  // "Active sprints" across projects, then a Kanban project: the sprint choice goes with the menu.
  await page.goto('/issues')
  await pickFilter(page, 'Sprint', 'Active sprints')
  await expect(page).toHaveURL(/[?&]sprint=active/)
  await expect(page.getByTestId('issues-count')).toHaveText('2 issues')
  await pickFilter(page, 'Project', `Kanban ${kanban}`)
  await expect(page).toHaveURL(new RegExp(`[?&]project=${kanban}`))
  await expect(page).not.toHaveURL(/[?&]sprint=/)
  await expect(page.getByTestId('issues-count')).toHaveText('3 issues')
  await expect.poll(() => rowKeys(page)).toEqual(flow.map((i) => i.key).sort())
  await expect(sprintMenu(page)).toHaveCount(0)
})

test('on a phone the top-bar Create button takes the tap and opens the create dialog', async ({ owner, openAs }) => {
  const key = newProjectKey('MB')
  await owner.api.createProject(key, `Mobile ${key}`)
  const page = await openAs(owner)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/projects/${key}/board`)

  const nav = page.getByRole('navigation', { name: 'Main' })
  const create = page.getByTestId('nav-create-issue')
  // A real click (Playwright checks that the button itself receives it) opens the dialog.
  await create.click()
  const modal = page.getByTestId('create-issue-modal')
  await expect(modal).toBeVisible()
  await expect(modal.getByTestId('create-issue-summary')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()

  // Nothing spills out of the nav over the button, from small to large phones.
  for (const width of [320, 360, 375, 390, 414]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth), `nav overflows at ${width}px`).toBe(true)
    expect(await takesTaps(create), `Create button covered at ${width}px`).toBe(true)
  }
  // Narrower still (a large system font, a foldable's cover screen) Projects no longer fits,
  // but Create is drawn over it and keeps its taps.
  for (const width of [244, 280, 300]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await takesTaps(create), `Create button covered at ${width}px`).toBe(true)
  }

  // Only Projects fits next to Create: the logo leads to Your work, the search button to Issues.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(nav.getByRole('button', { name: 'Projects' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Your work' })).toBeHidden()
  await expect(nav.getByRole('link', { name: 'Issues' })).toBeHidden()

  // The folded links' destinations are still a tap away.
  await page.getByRole('button', { name: 'Search issues' }).click()
  await expect(page).toHaveURL(/\/issues$/)
  await page.getByRole('link', { name: 'Gene Board home' }).click()
  await expect(page).toHaveURL(/\/$/)

  // Desktop keeps every link.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(nav.getByRole('link', { name: 'Your work' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Issues' })).toBeVisible()
})
