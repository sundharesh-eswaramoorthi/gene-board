import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../../support/fixtures.ts'

/**
 * Screenshots of every main screen at 1440×900 on the pristine demo seed, for visual review.
 * Written to e2e/screenshots/. Each shot also checks that the page settled (no loading
 * skeletons) and has no horizontal overflow.
 */
const SHOTS_DIR = path.resolve(import.meta.dirname, '../../screenshots')

test.describe.configure({ mode: 'serial' })

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  // Fonts and lazy images.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
}

async function shoot(page: Page, name: string) {
  await settle(page)
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement
    return el.scrollWidth - el.clientWidth
  })
  expect(overflow, `${name}: horizontal page overflow`).toBeLessThanOrEqual(0)
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), animations: 'disabled', caret: 'hide' })
}

test('light theme screens', async ({ page, demo, openAs }) => {
  // Signed out.
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Log in to Gene Board' })).toBeVisible()
  await shoot(page, '01-login')
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await shoot(page, '02-register')

  const app = await openAs(demo)
  await app.goto('/')
  await expect(app.getByTestId('dashboard-assigned')).toBeVisible()
  await expect(app.getByTestId('dashboard-activity')).toBeVisible()
  await shoot(app, '03-dashboard')

  await app.goto('/projects')
  await expect(app.getByTestId('projects-table')).toBeVisible()
  await shoot(app, '04-projects')

  await app.goto('/projects/GB/board')
  await expect(app.locator('[data-testid^="issue-card-"]').first()).toBeVisible()
  await shoot(app, '05-board-gb')

  await app.goto('/projects/GB/backlog')
  await expect(app.getByTestId('backlog-section-backlog')).toBeVisible()
  await shoot(app, '06-backlog-gb')

  await app.goto('/projects/GB/epics')
  await expect(app.getByTestId('epics-list')).toBeVisible()
  await shoot(app, '07-epics-gb')
  // One epic expanded.
  await app.getByTestId('epics-list').getByRole('button', { expanded: false }).first().click()
  await shoot(app, '08-epics-gb-expanded')

  await app.goto('/projects/GB/board?issue=GB-10')
  await expect(app.getByTestId('issue-view')).toBeVisible()
  await expect(app.getByTestId('issue-view').getByRole('tab', { name: /Comments/ })).toBeVisible()
  await shoot(app, '09-issue-modal')

  await app.goto('/browse/GB-10')
  await expect(app.getByTestId('issue-view')).toBeVisible()
  await shoot(app, '10-issue-page')

  await app.goto('/projects/GB/board')
  await expect(app.locator('[data-testid^="issue-card-"]').first()).toBeVisible()
  await app.getByTestId('nav-create-issue').click()
  await expect(app.getByTestId('create-issue-modal')).toBeVisible()
  await shoot(app, '11-create-issue-modal')
  await app.keyboard.press('Escape')

  await app.goto('/issues')
  await expect(app.getByTestId('issues-table')).toBeVisible()
  await shoot(app, '12-issues-search')

  await app.goto('/projects/GB/issues?type=story,bug&category=todo,in_progress')
  await expect(app.getByTestId('issues-table')).toBeVisible()
  await shoot(app, '13-issues-search-filtered')

  for (const [i, tab] of (['details', 'members', 'columns', 'labels'] as const).entries()) {
    await app.goto(`/projects/GB/settings${tab === 'details' ? '' : `?tab=${tab}`}`)
    await expect(app.getByTestId(`settings-tab-${tab}`)).toHaveAttribute('aria-selected', 'true')
    await shoot(app, `${14 + i}-settings-${tab}`)
  }

  await app.goto('/projects/GB/activity')
  await expect(app.locator('[data-testid^="activity-"]').first()).toBeVisible()
  await shoot(app, '18-activity-gb')

  await app.goto('/projects/OPS/board')
  await expect(app.locator('[data-testid^="issue-card-"]').first()).toBeVisible()
  await shoot(app, '19-board-ops-kanban')
})

test('dark theme screens', async ({ demo, openAs }) => {
  const app = await openAs(demo, { theme: 'dark' })
  await app.goto('/projects/GB/board')
  await expect(app.locator('html')).toHaveClass(/\bdark\b/)
  await expect(app.locator('[data-testid^="issue-card-"]').first()).toBeVisible()
  await shoot(app, '20-dark-board-gb')

  await app.goto('/projects/GB/board?issue=GB-10')
  await expect(app.getByTestId('issue-view')).toBeVisible()
  await shoot(app, '21-dark-issue-modal')

  await app.goto('/projects/GB/backlog')
  await expect(app.getByTestId('backlog-section-backlog')).toBeVisible()
  await shoot(app, '22-dark-backlog-gb')

  await app.goto('/')
  await expect(app.getByTestId('dashboard-assigned')).toBeVisible()
  await shoot(app, '23-dark-dashboard')

  await app.goto('/projects/GB/board')
  await app.getByTestId('nav-create-issue').click()
  await expect(app.getByTestId('create-issue-modal')).toBeVisible()
  await shoot(app, '24-dark-create-issue-modal')
  await app.keyboard.press('Escape')

  await app.goto('/projects/GB/settings?tab=columns')
  await expect(app.getByTestId('columns-list')).toBeVisible()
  await shoot(app, '25-dark-settings-columns')

  const guest = await openAs(null, { theme: 'dark' })
  await guest.goto('/login')
  await expect(guest.getByRole('heading', { name: 'Log in to Gene Board' })).toBeVisible()
  await shoot(guest, '26-dark-login')
})
