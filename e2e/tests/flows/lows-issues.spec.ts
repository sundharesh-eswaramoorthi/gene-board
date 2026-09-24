import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate } from '../../support/ui.ts'

test('a Kanban issue still in a leftover sprint can leave it but not switch sprints', async ({ owner, openAs }) => {
  // A Scrum project with a running and a planned sprint, then switched to Kanban.
  const key = newProjectKey('KL')
  await owner.api.createProject(key, `Leftover ${key}`)
  const running = await owner.api.createSprint(key, { name: 'Running sprint' })
  await owner.api.createSprint(key, { name: 'Future sprint' })
  const issue = await owner.api.createIssue(key, { summary: 'Still in the running sprint', sprintId: running.id })
  await owner.api.startSprint(running.id, isoDate(-2), isoDate(12))
  await owner.api.patch(`/projects/${key}`, { type: 'kanban' })

  const page = await openAs(owner)
  await page.goto(`/browse/${issue.key}`)
  const view = page.getByTestId('issue-view')
  await expect(view.getByRole('heading', { level: 1 })).toHaveText('Still in the running sprint')

  // No sprint picker offering the other leftover sprint: the sprint is shown with a way out.
  const field = view.getByTestId('issue-leftover-sprint')
  await expect(field).toHaveText('Running sprint')
  await expect(view.getByRole('button', { name: /^Sprint:/ })).toHaveCount(0)
  await field.getByRole('button', { name: 'Remove from Running sprint' }).click()
  await expect.poll(async () => (await owner.api.issue(issue.key)).sprint).toBeNull()
  await expect(field).toHaveCount(0)
})
