import type { Locator } from '@playwright/test'
import { register } from '../../support/api.ts'
import { WEB_URL } from '../../support/env.ts'
import { expect, newProjectKey, test, uid } from '../../support/fixtures.ts'

/** Left edge on screen of the first occurrence of each text inside `scope`: the order a reader sees. */
function screenX(scope: Locator, texts: string[]): Promise<number[]> {
  return scope.evaluate(
    (el, needles) =>
      needles.map((needle) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(needle) ?? -1
          if (at < 0) continue
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + needle.length)
          return range.getBoundingClientRect().left
        }
        throw new Error(`"${needle}" is not on the page`)
      }),
    texts,
  )
}

test('session: a request sent with the token a password change replaced does not sign you out', async ({ owner, openAs }) => {
  const key = newProjectKey('PW')
  await owner.api.createProject(key, `Rotated ${key}`)
  const page = await openAs(owner)

  // Hold the dashboard's project list: it was sent with the old token and gets its answer only
  // after the password change has revoked that token. (Every GET until then: in development
  // React mounts the page twice, which cancels the first one.)
  let release = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  let held = 0
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      held++
      await released
    }
    await route.continue().catch(() => undefined) // a cancelled request can't continue
  })
  await page.goto('/')
  await expect.poll(() => held).toBeGreaterThan(0)

  await page.getByRole('button', { name: `Account menu for ${owner.user.name}` }).click()
  await page.getByRole('menuitem', { name: 'Account settings' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Current password').fill(owner.password)
  await dialog.getByLabel('New password', { exact: true }).fill('rotated-password-3')
  await dialog.getByLabel('Confirm new password').fill('rotated-password-3')
  await dialog.getByRole('button', { name: /^Save/ }).click()
  // The page switched to the new token (the old one is revoked now).
  const stored = () => page.evaluate(() => localStorage.getItem('gb-token'))
  await expect.poll(stored).not.toBe(owner.token)
  const token = await stored()

  // The held request is rejected (401, old token); it is sent again with the new token instead
  // of ending the session the new token belongs to.
  const rejected = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/projects' && res.status() === 401)
  release()
  await rejected
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Account updated' })).toBeVisible()
  await expect(page.getByText(`Rotated ${key}`).first()).toBeVisible()
  await expect(page).toHaveURL(`${WEB_URL}/`)
  expect(await page.evaluate(() => localStorage.getItem('gb-token'))).toBe(token)
})

test('session: a 401 that arrives before the password change’s own answer waits for it', async ({ owner, openAs }) => {
  const key = newProjectKey('PW')
  await owner.api.createProject(key, `Waited ${key}`)
  const page = await openAs(owner)

  // Another tab of the same browser that only records every change to the stored token.
  const probe = await page.context().newPage()
  await probe.route('**/token-probe', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Probe</title>' }))
  const changes: (string | null)[] = []
  await probe.exposeFunction('tokenChanged', (value: string | null) => void changes.push(value))
  await probe.goto('/token-probe')
  await probe.evaluate(() => {
    const report = (window as unknown as { tokenChanged: (value: string | null) => void }).tokenChanged
    window.addEventListener('storage', (e) => {
      if (e.key === 'gb-token') report(e.newValue)
    })
  })

  // The password change reaches the server (which revokes the token this page holds) but its
  // answer is held back. The dashboard's project list, sent with that token earlier, is held
  // until the change is made, so its 401 reaches the page first.
  let changed = () => {}
  const passwordChanged = new Promise<void>((resolve) => (changed = resolve))
  let deliver = () => {}
  const delivered = new Promise<void>((resolve) => (deliver = resolve))
  await page.route('**/api/auth/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    const response = await route.fetch()
    changed()
    await delivered
    await route.fulfill({ response })
  })
  let held = 0
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      held++
      await passwordChanged
    }
    await route.continue().catch(() => undefined) // a cancelled request can't continue
  })
  await page.goto('/')
  await expect.poll(() => held).toBeGreaterThan(0)

  const rejected = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/projects' && res.status() === 401)
  await page.getByRole('button', { name: `Account menu for ${owner.user.name}` }).click()
  await page.getByRole('menuitem', { name: 'Account settings' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Current password').fill(owner.password)
  await dialog.getByLabel('New password', { exact: true }).fill('rotated-password-4')
  await dialog.getByLabel('Confirm new password').fill('rotated-password-4')
  await dialog.getByRole('button', { name: /^Save/ }).click()
  await (await rejected).finished()
  deliver()

  // The rejected request waited for the new token and was sent again with it.
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Account updated' })).toBeVisible()
  await expect(page.getByText(`Waited ${key}`).first()).toBeVisible()
  await expect(page).toHaveURL(`${WEB_URL}/`)
  const token = await page.evaluate(() => localStorage.getItem('gb-token'))
  expect(token).not.toBe(owner.token)
  // The stored token went straight from the old one to the new one: the session never ended.
  await expect.poll(() => changes).toEqual([token])
})

test('session: a tab that could not store its token still follows sign-ins in other tabs', async ({ newUser, openAs }) => {
  const first = await newUser('Unsaved')
  const second = await newUser('Elsewhere')
  const page = await openAs(null)
  // Storage is full: writing the token throws, reading still works.
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key === 'gb-token') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      setItem.call(this, key, value)
    }
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(first.user.email)
  await page.getByLabel('Password', { exact: true }).fill(first.password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('button', { name: `Account menu for ${first.user.name}` })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('gb-token'))).toBeNull()

  // Another tab, where the write works, signs in as someone else. This tab switches too, as
  // it does when its own token was stored.
  const other = await page.context().newPage()
  await other.goto('/login')
  await other.getByLabel('Email').fill(second.user.email)
  await other.getByLabel('Password', { exact: true }).fill(second.password)
  await other.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(other.getByRole('button', { name: `Account menu for ${second.user.name}` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Account menu for ${second.user.name}` })).toBeVisible()
  await expect(page).toHaveURL(`${WEB_URL}/`)
})

test('session: signing in works when the browser blocks site storage', async ({ newUser, openAs }) => {
  const user = await newUser('NoStorage')
  const key = newProjectKey('NS')
  await user.api.createProject(key, `Stored nowhere ${key}`)
  const page = await openAs(null)
  // Like a browser set to block site data: every use of web storage throws.
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('Access is denied for this document.', 'SecurityError')
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, get: blocked })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: blocked })
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()

  // The requests after sign-in carry the token kept for this page: the dashboard loads and stays.
  await expect(page.getByText(`Stored nowhere ${key}`).first()).toBeVisible()
  await expect(page).toHaveURL(`${WEB_URL}/`)
  // So do the next pages (moving within the app; a reload would start signed out).
  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('menuitem', { name: 'View all projects' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('link', { name: `Stored nowhere ${key}` }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: `Account menu for ${user.user.name}` })).toBeVisible()
})

test('text: emoji stay whole in avatar initials and activity excerpts', async ({ apiRequest, openAs }) => {
  const id = uid(6)
  const user = await register(apiRequest, `Sam ${id} 🚀`, `e2e-emoji-${id.toLowerCase()}@example.test`)
  const key = newProjectKey('EM')
  await user.api.createProject(key, `Emoji ${key}`)
  const issue = await user.api.createIssue(key, { summary: 'Emoji excerpt' })
  // 158 letters, then an emoji right where the 160-character excerpt is cut.
  await user.api.post(`/issues/${issue.key}/comments`, { body: `${'y'.repeat(158)}🎉 Shipping tomorrow.` })

  const page = await openAs(user)
  await page.goto(`/projects/${key}/activity`)
  // "S" and the rocket, not "S" and half of it (drawn as "�").
  const avatar = page.getByRole('button', { name: `Account menu for ${user.user.name}` }).getByRole('img')
  await expect(avatar).toHaveText('S🚀')
  const row = page.locator('[data-testid^="activity-"]').filter({ hasText: 'commented on' })
  await expect(row).toContainText(`${'y'.repeat(20)}🎉…`)
})

test('activity: a right-to-left override in a name or value does not reorder the line', async ({ owner, apiRequest, openAs }) => {
  const key = newProjectKey('BD')
  await owner.api.createProject(key, `Bidi ${key}`)
  // U+202E RIGHT-TO-LEFT OVERRIDE, never closed: unisolated, it reverses whatever follows it.
  const id = uid(4)
  const mallory = await register(apiRequest, `Mallory‮ ${id}`, `e2e-bidi-${id.toLowerCase()}-${uid(4).toLowerCase()}@example.test`)
  expect(mallory.user.name).toContain('‮')
  await owner.api.addMember(key, mallory.user.email, 'member')
  const issue = await owner.api.createIssue(key, { summary: 'Alpha‮ one' })
  expect(issue.summary).toContain('‮')
  await mallory.api.patch(`/issues/${issue.key}`, { summary: 'Beta' })

  const page = await openAs(owner)
  await page.goto(`/projects/${key}/activity`)
  const row = page.locator('[data-testid^="activity-"]').filter({ hasText: 'changed Summary' })
  await expect(row).toContainText(`changed Summary of ${issue.key} from “Alpha‮ one” to “Beta”`)
  // On screen: the name, "changed", the key, the old summary, then the new one, left to right.
  const x = await screenX(row, ['Mallory', 'changed', issue.key, 'Alpha', 'one', 'Beta'])
  expect(x).toEqual([...x].sort((a, b) => a - b))
})
