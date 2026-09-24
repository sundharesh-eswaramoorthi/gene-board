import type { Session } from '../../support/api.ts'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate } from '../../support/ui.ts'

/** A Scrum project with an active sprint holding one done and two open issues (one with a subtask). */
async function projectWithActiveSprint(owner: Session, prefix: string) {
  const key = newProjectKey(prefix)
  await owner.api.createProject(key, `Sprint ${key}`)
  const sprint = await owner.api.createSprint(key)
  const statuses = await owner.api.statuses(key)
  const doneStatus = statuses.find((s) => s.category === 'done')!
  const finished = await owner.api.createIssue(key, { summary: 'Finished work', sprintId: sprint.id, statusId: doneStatus.id, storyPoints: 3 })
  const openA = await owner.api.createIssue(key, { summary: 'Unfinished A', sprintId: sprint.id, storyPoints: 2 })
  const openB = await owner.api.createIssue(key, { summary: 'Unfinished B', sprintId: sprint.id })
  const subtask = await owner.api.createIssue(key, { type: 'subtask', summary: 'Part of A', parentId: openA.id })
  await owner.api.startSprint(sprint.id, isoDate(-7), isoDate(7))
  return { key, sprint, finished, openA, openB, subtask }
}

test.describe('complete sprint', () => {
  test('open issues go back to the backlog', async ({ owner, openAs }) => {
    const { key, sprint, finished, openA, openB, subtask } = await projectWithActiveSprint(owner, 'CB')
    const page = await openAs(owner)
    await page.goto(`/projects/${key}/board`)
    await expect(page.getByTestId(`issue-card-${openB.key}`)).toBeVisible()

    await page.getByTestId('complete-sprint-button').click()
    const dialog = page.getByTestId('complete-sprint-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: `Complete ${sprint.name}` })).toBeVisible()
    await expect(dialog).toContainText('This sprint contains 1 completed issue and 2 open issues.')
    // No planned sprint exists, so the default target is the backlog.
    await expect(dialog.getByTestId('complete-sprint-target')).toHaveValue('backlog')
    await dialog.getByTestId('complete-sprint-submit').click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${sprint.name} completed` })).toContainText(
      '1 issue done · 2 open issues moved to the backlog',
    )

    // The board has no active sprint any more.
    await expect(page.getByText('No active sprint', { exact: true })).toBeVisible()

    // Server: sprint completed, open issues (and the subtask) in the backlog, the done one stays.
    const completed = await owner.api.get<{ state: string }>(`/sprints/${sprint.id}`)
    expect(completed.state).toBe('completed')
    for (const k of [openA.key, openB.key, subtask.key]) expect((await owner.api.issue(k)).sprint).toBeNull()
    expect((await owner.api.issue(finished.key)).sprint?.id).toBe(sprint.id)

    // Backlog page: no sprint sections, the open issues are in the backlog.
    await page.getByRole('link', { name: 'Go to Backlog' }).click()
    const backlog = page.getByTestId('backlog-section-backlog')
    await expect(backlog.getByTestId(`backlog-row-${openA.key}`)).toBeVisible()
    await expect(backlog.getByTestId(`backlog-row-${openB.key}`)).toBeVisible()
    await expect(page.getByTestId(`backlog-row-${finished.key}`)).toHaveCount(0)
    await expect(page.locator('[data-testid^="backlog-section-"]')).toHaveCount(1)
  })

  test('open issues move to a new sprint', async ({ owner, openAs }) => {
    const { key, sprint, finished, openA, openB, subtask } = await projectWithActiveSprint(owner, 'CN')
    const page = await openAs(owner)
    await page.goto(`/projects/${key}/board`)
    await expect(page.getByTestId(`issue-card-${openA.key}`)).toBeVisible()

    await page.getByTestId('complete-sprint-button').click()
    const dialog = page.getByTestId('complete-sprint-dialog')
    await dialog.getByTestId('complete-sprint-target').selectOption({ label: 'New sprint' })
    await expect(dialog).toContainText('A new planned sprint is created for the open issues.')
    await dialog.getByTestId('complete-sprint-submit').click()
    await expect(dialog).toBeHidden()

    const sprints = await owner.api.sprints(key)
    const next = sprints.find((s) => s.id !== sprint.id)!
    expect(next).toMatchObject({ state: 'planned', name: `${key} Sprint 2`, issueCount: 2 })
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${sprint.name} completed` })).toContainText(
      `2 open issues moved to ${next.name}`,
    )
    for (const k of [openA.key, openB.key, subtask.key]) expect((await owner.api.issue(k)).sprint?.id).toBe(next.id)
    expect((await owner.api.issue(finished.key)).sprint?.id).toBe(sprint.id)

    // Backlog shows the new planned sprint holding the open issues, and an empty backlog.
    await page.goto(`/projects/${key}/backlog`)
    const section = page.getByTestId(`backlog-section-${next.id}`)
    await expect(section).toContainText(next.name)
    await expect(section.getByTestId(`backlog-row-${openA.key}`)).toBeVisible()
    await expect(section.getByTestId(`backlog-row-${openB.key}`)).toBeVisible()
    await expect(section.getByTestId(`backlog-start-sprint-${next.id}`)).toBeVisible()
    await expect(page.getByTestId('backlog-section-backlog')).toContainText('Your backlog is empty')
  })
})
