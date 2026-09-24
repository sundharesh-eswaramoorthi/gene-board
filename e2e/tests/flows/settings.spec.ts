import type { Page } from '@playwright/test'
import type { Label, Status } from '../../support/api.ts'
import { ALEX } from '../../support/env.ts'
import { expect, newProjectKey, test, uid } from '../../support/fixtures.ts'
import { dragTo, testIdKeys } from '../../support/ui.ts'

const columnIds = async (page: Page) => (await testIdKeys(page.getByTestId('columns-list'), 'column-row-')).map(Number)

test.describe('project settings', () => {
  test('admin: add a member, manage columns and labels', async ({ owner, openAs }) => {
    const key = newProjectKey('ST')
    await owner.api.createProject(key, `Settings ${key}`)
    const page = await openAs(owner)
    await page.goto(`/projects/${key}/settings`)
    await expect(page.getByTestId('project-details-name')).toHaveValue(`Settings ${key}`)

    // --- Members: add alex@geneboard.dev as a member
    await page.getByTestId('settings-tab-members').click()
    await expect(page).toHaveURL(/[?&]tab=members/)
    const alex = (await owner.api.get<{ id: number; email: string }[]>(`/users?query=alex`)).find((u) => u.email === ALEX.email)!
    await page.getByTestId('add-member-email').fill(ALEX.email)
    await page.getByTestId('add-member-role').selectOption('member')
    await page.getByTestId('add-member-form').getByRole('button', { name: 'Add' }).click()
    const alexRow = page.getByTestId(`member-${alex.id}`)
    await expect(alexRow).toContainText(ALEX.name)
    await expect(alexRow.getByLabel(`Role of ${ALEX.name}`)).toHaveValue('member')
    await expect(page.getByTestId('add-member-email')).toHaveValue('')
    const members = await owner.api.get<{ user: { email: string }; role: string }[]>(`/projects/${key}/members`)
    expect(members).toEqual(expect.arrayContaining([expect.objectContaining({ user: expect.objectContaining({ email: ALEX.email }), role: 'member' })]))
    // Adding them again is refused with a message.
    await page.getByTestId('add-member-email').fill(ALEX.email)
    await page.getByTestId('add-member-form').getByRole('button', { name: 'Add' }).click()
    await expect(page.getByTestId('add-member-form').getByRole('alert')).toContainText(/already/i)

    // --- Columns: add "QA", rename it, move it before "In Review"
    await page.getByTestId('settings-tab-columns').click()
    const initial = await owner.api.statuses(key)
    await expect.poll(() => columnIds(page)).toEqual(initial.map((s) => s.id))
    await page.getByTestId('add-column-name').fill('QA')
    await page.getByTestId('add-column-form').getByLabel('Category').selectOption('in_progress')
    await page.getByTestId('add-column-form').getByRole('button', { name: 'Add column' }).click()
    await expect.poll(async () => (await owner.api.statuses(key)).map((s) => s.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Done', 'QA'])
    const qa = (await owner.api.statuses(key)).find((s) => s.name === 'QA')!
    const qaRow = page.getByTestId(`column-row-${qa.id}`)
    await expect(qaRow).toBeVisible()

    await qaRow.getByRole('button', { name: 'Edit column name: QA' }).click()
    await qaRow.getByRole('textbox', { name: 'Column name' }).fill('Quality check')
    await qaRow.getByRole('textbox', { name: 'Column name' }).press('Enter')
    await expect(qaRow.getByRole('button', { name: 'Edit column name: Quality check' })).toBeVisible()
    await expect.poll(async () => (await owner.api.statuses(key)).find((s) => s.id === qa.id)?.name).toBe('Quality check')

    const inReview = initial.find((s) => s.name === 'In Review')!
    await dragTo(page, qaRow.getByRole('button', { name: 'Reorder column Quality check' }), page.getByTestId(`column-row-${inReview.id}`))
    const expectedOrder = ['To Do', 'In Progress', 'Quality check', 'In Review', 'Done']
    await expect
      .poll(async () => (await owner.api.statuses(key)).sort((a: Status, b: Status) => a.position - b.position).map((s) => s.name))
      .toEqual(expectedOrder)
    const ordered = (await owner.api.statuses(key)).map((s) => s.id)
    await page.reload()
    await expect.poll(() => columnIds(page)).toEqual(ordered)

    // --- Labels: create, rename, recolour, delete
    await page.getByTestId('settings-tab-labels').click()
    const name = `backend-${uid(4).toLowerCase()}`
    await page.getByTestId('create-label-name').fill(name)
    await page.getByTestId('create-label-form').getByRole('button', { name: 'Create label' }).click()
    await expect.poll(async () => (await owner.api.get<Label[]>(`/projects/${key}/labels`)).map((l) => l.name)).toEqual([name])
    const label = (await owner.api.get<Label[]>(`/projects/${key}/labels`))[0]
    const labelRow = page.getByTestId(`label-row-${label.id}`)
    await expect(labelRow).toBeVisible()

    await labelRow.getByRole('button', { name: `Edit label name: ${name}` }).click()
    await labelRow.getByRole('textbox', { name: 'Label name' }).fill(`${name}-api`)
    await labelRow.getByRole('textbox', { name: 'Label name' }).press('Enter')
    await expect(labelRow.getByRole('button', { name: `Edit label name: ${name}-api` })).toBeVisible()
    await expect.poll(async () => (await owner.api.get<Label[]>(`/projects/${key}/labels`))[0].name).toBe(`${name}-api`)

    await labelRow.getByRole('button', { name: /^Colour of .*Change colour$/ }).click()
    const swatches = page.getByRole('group', { name: `Colour of ${name}-api` })
    await expect(swatches).toBeVisible()
    // Pick a colour other than the current one.
    await expect(swatches.locator('button[aria-pressed="true"]')).toHaveCount(1)
    const target = swatches.locator('button[aria-pressed="false"]').first()
    const colourName = await target.getAttribute('aria-label')
    await target.click()
    await expect.poll(async () => (await owner.api.get<Label[]>(`/projects/${key}/labels`))[0].color).not.toBe(label.color)
    await expect(labelRow.getByRole('button', { name: `Colour of ${name}-api: ${colourName}. Change colour` })).toBeVisible()

    await page.keyboard.press('Escape')
    await labelRow.getByRole('button', { name: `Delete label ${name}-api` }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText(`Delete label “${name}-api”?`)
    await confirm.getByRole('button', { name: 'Delete label' }).click()
    await expect(labelRow).toHaveCount(0)
    await expect.poll(async () => (await owner.api.get<Label[]>(`/projects/${key}/labels`)).length).toBe(0)
  })

  test('viewer: every tab is read-only', async ({ owner, newUser, openAs }) => {
    const key = newProjectKey('VW')
    await owner.api.createProject(key, `Viewer ${key}`)
    await owner.api.post(`/projects/${key}/labels`, { name: 'docs' })
    await owner.api.createIssue(key, { summary: 'Something to look at' })
    const viewer = await newUser('Viewer')
    await owner.api.addMember(key, viewer.user.email, 'viewer')

    const page = await openAs(viewer)
    await page.goto(`/projects/${key}/settings`)
    await expect(page.getByTestId('settings-read-only')).toContainText('You have viewer access.')
    // Details are shown as plain values, without inputs.
    await expect(page.getByRole('main').getByText(`Viewer ${key}`, { exact: true }).first()).toBeVisible()
    await expect(page.getByTestId('project-details-name')).toHaveCount(0)
    await expect(page.getByTestId('project-details-save')).toHaveCount(0)
    await expect(page.getByTestId('project-delete')).toHaveCount(0)

    await page.getByTestId('settings-tab-members').click()
    await expect(page.getByTestId('members-list')).toContainText(owner.user.name)
    await expect(page.getByTestId('add-member-form')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: /^Role of / })).toHaveCount(0)

    await page.getByTestId('settings-tab-columns').click()
    await expect(page.getByTestId('columns-list')).toContainText('In Progress')
    await expect(page.getByTestId('add-column-form')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Reorder column / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Delete column / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Edit column name/ })).toHaveCount(0)

    await page.getByTestId('settings-tab-labels').click()
    await expect(page.getByTestId('labels-list')).toContainText('docs')
    await expect(page.getByTestId('create-label-form')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Delete label / })).toHaveCount(0)

    // The rest of the project is read-only too.
    await page.goto(`/projects/${key}/backlog`)
    await expect(page.getByTestId('backlog-page')).toContainText('Read only')
    await expect(page.getByTestId('backlog-create-issue')).toHaveCount(0)
    await expect(page.getByTestId('backlog-create-sprint')).toHaveCount(0)
    const row = page.locator('[data-testid^="backlog-row-"]').first()
    await row.click()
    const view = page.getByTestId('issue-view')
    await expect(view).toBeVisible()
    await expect(view.getByRole('button', { name: /^Edit summary/ })).toHaveCount(0)
    await expect(view.getByRole('button', { name: 'Link issue' })).toHaveCount(0)
    await expect(view.getByRole('button', { name: /^Priority:/ })).toBeDisabled()
  })
})
