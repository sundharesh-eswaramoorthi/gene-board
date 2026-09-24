import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../../support/fixtures.ts'

/** Relative luminance (0 = black, 1 = white) of an element's computed background colour. */
async function luminance(target: Locator): Promise<number> {
  const color = await target.evaluate((el) => getComputedStyle(el).backgroundColor)
  const canvas = await target.page().evaluate((c) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data)
  }, color)
  const [r, g, b] = canvas.slice(0, 3).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

async function chooseTheme(page: Page, accountMenu: Locator, theme: 'Light' | 'Dark' | 'System') {
  await accountMenu.click()
  await page.getByRole('menuitemradio', { name: theme }).click()
  await expect(page.getByRole('menuitemradio', { name: theme })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
}

test('dark mode: the theme menu switches the whole app and the choice persists', async ({ demo, openAs }) => {
  const page = await openAs(demo)
  await page.goto('/projects/GB/board')
  const card = page.locator('[data-testid^="issue-card-"]').first()
  await expect(card).toBeVisible()
  const main = page.locator('main')
  const accountMenu = page.getByRole('button', { name: /^Account menu for / })

  // Starts light (the browser prefers light and nothing is stored).
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  await expect.poll(() => luminance(main)).toBeGreaterThan(0.8)

  await chooseTheme(page, accountMenu, 'Dark')
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  expect(await page.evaluate(() => localStorage.getItem('gb-theme'))).toBe('dark')
  // The switch is instant: no element is caught half-way through a colour transition.
  expect(await luminance(card)).toBeLessThan(0.15)
  await expect.poll(() => luminance(main)).toBeLessThan(0.1)
  // Text stays readable: card text is light on the dark card.
  const textColor = await card.evaluate((el) => getComputedStyle(el).color)
  expect(textColor).not.toBe('rgb(0, 0, 0)')

  // Survives a reload (applied before first paint, no flash of the light theme).
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await expect(card).toBeVisible()
  await expect.poll(() => luminance(main)).toBeLessThan(0.1)

  // The issue modal is dark too.
  await card.click()
  await expect(page.getByTestId('issue-view')).toBeVisible()
  await expect.poll(() => luminance(page.getByRole('dialog'))).toBeLessThan(0.15)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // "System" follows the OS preference.
  await chooseTheme(page, accountMenu, 'System')
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

  await chooseTheme(page, accountMenu, 'Light')
  expect(await page.evaluate(() => localStorage.getItem('gb-theme'))).toBe('light')
  await expect.poll(() => luminance(main)).toBeGreaterThan(0.8)
})

test('dark mode: the login page has its own theme toggle', async ({ page }) => {
  await page.goto('/login')
  const toggle = page.getByRole('button', { name: /^Theme: / })
  await expect(toggle).toHaveAccessibleName('Theme: System (switch to light)')
  await toggle.click() // → light
  await toggle.click() // → dark
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await expect.poll(() => luminance(page.locator('body'))).toBeLessThan(0.1)
  await expect(page.getByRole('heading', { name: 'Log in to Gene Board' })).toBeVisible()
})
