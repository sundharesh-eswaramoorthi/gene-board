import type { Session } from '../../support/api.ts'
import { expect, newProjectKey, test } from '../../support/fixtures.ts'
import { isoDate, pickOption } from '../../support/ui.ts'

/**
 * Keyboard focus around dialogs: it moves into a dialog as it opens and goes back to what opened
 * the dialog when it closes (not to the top of the page).
 *
 * Not covered: `Dialog` skipping a `data-autofocus` element that is disabled as it opens (no
 * dialog in the app opens with one disabled).
 */

/** A Scrum project whose active sprint holds two open issues. */
async function projectWithActiveSprint(owner: Session, prefix: string) {
  const key = newProjectKey(prefix)
  await owner.api.createProject(key, `Focus ${key}`)
  const sprint = await owner.api.createSprint(key)
  const first = await owner.api.createIssue(key, { summary: 'Draft the release notes', sprintId: sprint.id })
  const second = await owner.api.createIssue(key, { summary: 'Update the changelog', sprintId: sprint.id })
  await owner.api.startSprint(sprint.id, isoDate(-3), isoDate(11))
  return { key, sprint, first, second }
}

test.describe('dialog focus', () => {
  test('closing the issue modal returns focus to the board card that opened it', async ({ owner, openAs }) => {
    const { key, first, second } = await projectWithActiveSprint(owner, 'FB')
    const [, inProgress] = await owner.api.statuses(key)
    const page = await openAs(owner)
    await page.goto(`/projects/${key}/board`)
    const modal = page.getByRole('dialog')
    const view = page.getByTestId('issue-view')

    // Keyboard: Enter on a card opens the issue with focus in the modal; Escape closes it.
    const card = page.getByTestId(`issue-card-${second.key}`)
    await card.focus()
    await page.keyboard.press('Enter')
    await expect(view).toHaveAttribute('data-issue-key', second.key)
    await expect(modal).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
    await expect(card).toBeFocused()

    // Mouse: click a card, close with the Close button.
    const other = page.getByTestId(`issue-card-${first.key}`)
    await other.click()
    await expect(view).toHaveAttribute('data-issue-key', first.key)
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect(other).toBeFocused()

    // A status change re-creates the card in another column: focus goes to it there.
    await card.focus()
    await page.keyboard.press('Enter')
    await expect(view).toHaveAttribute('data-issue-key', second.key)
    await view.getByTestId('issue-status').click()
    await pickOption(page, inProgress.name)
    const moved = page.getByTestId(`board-column-${inProgress.id}`).getByTestId(`issue-card-${second.key}`)
    await expect(moved).toBeAttached()
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
    await expect(moved).toBeFocused()
  })

  test('closing the issue modal returns focus to the backlog row that opened it', async ({ owner, openAs }) => {
    const { key, first } = await projectWithActiveSprint(owner, 'FR')
    const page = await openAs(owner)
    await page.goto(`/projects/${key}/backlog`)

    const row = page.getByTestId(`backlog-row-${first.key}`)
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('issue-view')).toHaveAttribute('data-issue-key', first.key)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(row).toBeFocused()
  })

  test('cancelling a confirm dialog returns focus to its trigger', async ({ owner, openAs }) => {
    const { key, first } = await projectWithActiveSprint(owner, 'FC')
    await owner.api.post(`/issues/${first.key}/comments`, { body: 'Ship it on Friday' })
    const page = await openAs(owner)
    // Opened from the URL, so nothing on the page opened the modal.
    await page.goto(`/projects/${key}/board?issue=${first.key}`)
    const view = page.getByTestId('issue-view')
    const comments = view.getByRole('tabpanel')
    await expect(comments.getByText('Ship it on Friday')).toBeVisible()

    // Keyboard: the confirm dialog focuses Cancel; Enter on it cancels.
    const remove = comments.getByRole('button', { name: 'Delete', exact: true })
    await remove.focus()
    await page.keyboard.press('Enter')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(confirm).toBeHidden()
    await expect(remove).toBeFocused()

    // Escape cancels too, and leaves the issue modal open. Escape goes to the topmost dialog, and
    // Radix makes the confirm dialog topmost a render after it appears (the issue modal behind it
    // then stops taking the pointer): wait for that, as a person pressing Escape would have.
    await remove.click()
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await expect(view).toHaveCSS('pointer-events', 'none')
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(remove).toBeFocused()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(comments.getByText('Ship it on Friday')).toBeVisible()

    // Closing the modal that no element opened focuses the issue's card (once the modal is
    // topmost again).
    await expect(view).toHaveCSS('pointer-events', 'auto')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByTestId(`issue-card-${first.key}`)).toBeFocused()
  })

  test('leaving the issue modal through "Discard unsaved changes?" returns focus to the card', async ({
    owner,
    openAs,
  }) => {
    const { key, first, second } = await projectWithActiveSprint(owner, 'FD')
    const page = await openAs(owner)
    await page.goto(`/projects/${key}/board`)
    const modal = page.getByRole('dialog')
    const view = page.getByTestId('issue-view')
    const discard = page.getByRole('alertdialog').filter({ hasText: 'Discard unsaved changes?' })
    const writeDraft = async () => {
      await view.getByRole('button', { name: 'Add a comment…' }).click()
      await view.getByRole('textbox', { name: 'Add a comment' }).fill('Half-written thought')
    }

    // The confirm dialog and the modal close together, and the confirm's opener (the modal's
    // Close button) goes with the modal: focus still ends on the card, not on the page.
    const card = page.getByTestId(`issue-card-${first.key}`)
    await card.click()
    await expect(view).toHaveAttribute('data-issue-key', first.key)
    await writeDraft()
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await discard.getByRole('button', { name: 'Discard' }).click()
    await expect(modal).toBeHidden()
    await expect(card).toBeFocused()

    // Same when leaving with browser Back, from a modal opened with the keyboard.
    const other = page.getByTestId(`issue-card-${second.key}`)
    await other.focus()
    await page.keyboard.press('Enter')
    await expect(view).toHaveAttribute('data-issue-key', second.key)
    await writeDraft()
    await page.goBack()
    await discard.getByRole('button', { name: 'Discard' }).click()
    await expect(modal).toBeHidden()
    await expect(other).toBeFocused()
  })

  test('a dialog opened from a menu returns focus to the menu button', async ({ owner, openAs }) => {
    const key = newProjectKey('FM')
    await owner.api.createProject(key, `Focus ${key}`)
    const sprint = await owner.api.createSprint(key)
    const page = await openAs(owner)
    await page.goto(`/projects/${key}/backlog`)
    const menuButton = page.getByTestId(`backlog-sprint-menu-${sprint.id}`)

    // The menu closes as its item opens the dialog: focus goes back to the button that opened
    // the menu.
    await menuButton.click()
    await page.getByRole('menuitem', { name: 'Edit sprint' }).click()
    await expect(page.getByTestId('sprint-name')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('edit-sprint-dialog')).toBeHidden()
    await expect(menuButton).toBeFocused()

    // A confirm dialog too, with the keyboard all the way.
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Edit sprint' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Delete sprint' })).toBeFocused()
    await page.keyboard.press('Enter')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(menuButton).toBeFocused()
  })

  test('the Complete sprint dialog takes focus on its first open', async ({ owner, openAs }) => {
    const { key, sprint } = await projectWithActiveSprint(owner, 'FS')
    const page = await openAs(owner)
    // Hold the dialog's planned-sprints lookup, so it opens while that list is still loading.
    const held: (() => void)[] = []
    await page.route(
      (url) => url.pathname === `/api/projects/${key}/sprints` && url.searchParams.get('state') === 'planned',
      async (route) => {
        await new Promise<void>((resolve) => held.push(resolve))
        await route.continue()
      },
    )

    for (const [path, openerId] of [
      ['board', 'complete-sprint-button'],
      ['backlog', `backlog-complete-sprint-${sprint.id}`],
    ]) {
      // A fresh page load each time: nothing is cached yet.
      await page.goto(`/projects/${key}/${path}`)
      const opener = page.getByTestId(openerId)
      await opener.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByTestId('complete-sprint-dialog')
      const submit = dialog.getByTestId('complete-sprint-submit')
      const target = dialog.getByTestId('complete-sprint-target')
      await expect.poll(() => held.length).toBeGreaterThan(0)
      await expect(submit).toBeDisabled()
      await expect(target).toBeFocused()
      // Its default isn't known yet: it says so rather than "move to the backlog".
      await expect(target).toHaveAttribute('aria-busy', 'true')
      await expect(target).toHaveAccessibleDescription('Loading planned sprints…')

      for (const release of held.splice(0)) release()
      await expect(submit).toBeEnabled()
      await expect(target).not.toHaveAttribute('aria-busy')
      await expect(target).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(opener).toBeFocused()
    }
  })
})
