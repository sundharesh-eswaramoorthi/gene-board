import { API_URL, WEB_URL } from '../../support/env.ts'
import { expect, test } from '../../support/fixtures.ts'

test.describe('session hardening', () => {
  test('login: a crafted ?next= with control characters stays on the app', async ({ newUser, openAs }) => {
    const user = await newUser('Next')
    const page = await openAs(null)
    // URL parsers drop tabs and newlines, so "/<tab>/example.com" means "//example.com".
    for (const next of ['/\t/example.com', '/\n/example.com', '/\t\\example.com']) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`)
      await page.getByLabel('Email').fill(user.user.email)
      await page.getByLabel('Password', { exact: true }).fill(user.password)
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await expect(page).toHaveURL(`${WEB_URL}/`)
      await expect(page.getByRole('button', { name: `Account menu for ${user.user.name}` })).toBeVisible()
      await expect(page.getByText('Something went wrong')).toHaveCount(0)
      await page.evaluate(() => localStorage.removeItem('gb-token'))
    }

    // Signed in already: the login page forwards to ?next=, with the same guard.
    const signedIn = await openAs(user)
    await signedIn.goto(`/login?next=${encodeURIComponent('/\t/example.com')}`)
    await expect(signedIn).toHaveURL(`${WEB_URL}/`)
    await signedIn.goto(`/login?next=${encodeURIComponent('/projects?create=1')}`)
    await expect(signedIn).toHaveURL(/\/projects/)
  })

  test('account settings: a password change keeps this session and revokes older tokens', async ({ newUser, openAs, apiRequest }) => {
    const user = await newUser('Rotate')
    const page = await openAs(user)
    await page.goto('/')
    await page.getByRole('button', { name: `Account menu for ${user.user.name}` }).click()
    await page.getByRole('menuitem', { name: 'Account settings' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Current password').fill(user.password)
    await dialog.getByLabel('New password', { exact: true }).fill('rotated-password-2')
    await dialog.getByLabel('Confirm new password').fill('rotated-password-2')
    await dialog.getByRole('button', { name: /^Save/ }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Account updated' })).toBeVisible()

    // This browser switched to the new token: it stays signed in, also after a reload.
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByRole('button', { name: `Account menu for ${user.user.name}` })).toBeVisible()
    const token = await page.evaluate(() => localStorage.getItem('gb-token'))
    expect(token).not.toBe(user.token)

    // The token issued before the change (another device, a stolen copy) no longer works.
    const old = await apiRequest.get(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${user.token}` } })
    expect(old.status()).toBe(401)
    const current = await apiRequest.get(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(current.status()).toBe(200)
  })
})
