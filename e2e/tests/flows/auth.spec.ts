import { expect, test, uid } from '../../support/fixtures.ts'

test.describe('authentication', () => {
  test('register, log out, log back in; a wrong password shows an error', async ({ page }) => {
    const id = uid(6).toLowerCase()
    const name = `Reg ${id.toUpperCase()}`
    const email = `e2e-reg-${id}@example.test`
    const password = 'correct-horse-9'

    // Signed-out visitors land on the login page.
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)

    await page.getByRole('link', { name: 'Create an account' }).click()
    await expect(page).toHaveURL(/\/register/)
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()

    // Client-side validation first.
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Enter your name')).toBeVisible()

    await page.getByLabel('Full name').fill(name)
    await page.getByLabel('Work email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()

    // → dashboard ("Your work") for the new account, which has no projects yet.
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('dashboard-getting-started')).toBeVisible()
    await expect(page.getByRole('button', { name: `Account menu for ${name}` })).toBeVisible()

    // Log out from the user menu.
    await page.getByRole('button', { name: `Account menu for ${name}` }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in to Gene Board' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('gb-token'))).toBeNull()

    // A protected page now bounces back to login.
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects/)

    // Wrong password → server message, still on the login page.
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-1')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible()
    await expect(page).toHaveURL(/\/login/)

    // Right password → back to where we were going.
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByRole('button', { name: `Account menu for ${name}` })).toBeVisible()

    // The session survives a reload.
    await page.reload()
    await expect(page.getByRole('button', { name: `Account menu for ${name}` })).toBeVisible()
  })

  test('registering an email that is taken shows a field error', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Duplicate Demo')
    await page.getByLabel('Work email').fill('demo@geneboard.dev')
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('An account with this email already exists')).toBeVisible()
    await expect(page).toHaveURL(/\/register/)
  })
})
