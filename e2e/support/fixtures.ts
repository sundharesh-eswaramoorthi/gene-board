import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { login, register, type Session } from './api.ts'
import { DEMO, WEB_URL } from './env.ts'

const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Random upper-case suffix (no 0/O/1/I), unique enough per run. */
export function uid(length = 5): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)]
  return out
}

/** A fresh project key: `prefix` (letters) + random suffix, at most 10 characters. */
export function newProjectKey(prefix: string): string {
  const key = `${prefix}${uid(Math.max(2, 7 - prefix.length))}`
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new Error(`bad generated project key ${key}`)
  return key
}

/**
 * Console noise that is not an app error: failed HTTP requests the test provoked on purpose
 * (e.g. a 401 on a wrong password) are reported by Chromium as "Failed to load resource".
 */
const IGNORED_CONSOLE = [/Failed to load resource/, /\[vite\]/, /Download the React DevTools/]

/**
 * Records uncaught page errors, console errors and server errors (5xx from the API) so every
 * test can assert there were none.
 */
function trackErrors(page: Page, errors: string[]) {
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('response', (res) => {
    if (res.status() >= 500 && new URL(res.url()).pathname.startsWith('/api/')) {
      errors.push(`HTTP ${res.status()} from ${res.request().method()} ${res.url()}`)
    }
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return
    errors.push(`console.error: ${text}`)
  })
}

export interface OpenOptions {
  /** Theme preference stored before the app loads. */
  theme?: 'light' | 'dark' | 'system'
}

interface Fixtures {
  /** HTTP client for the API (setup and server-side assertions). */
  apiRequest: APIRequestContext
  /** Browser errors collected from every page of the test; asserted empty at the end. */
  browserErrors: string[]
  /** A brand-new registered account (admin of whatever it creates). */
  owner: Session
  /** The seeded demo account (admin of GB and OPS). */
  demo: Session
  /** Registers another fresh account. */
  newUser: (label?: string) => Promise<Session>
  /** Logs in an existing account through the API. */
  loginAs: (email: string, password?: string) => Promise<Session>
  /** Opens a new browser context signed in as `session` (or signed out for null). */
  openAs: (session: Session | null, options?: OpenOptions) => Promise<Page>
}

export const test = base.extend<Fixtures>({
  apiRequest: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext()
    await use(ctx)
    await ctx.dispose()
  },

  browserErrors: async ({}, use) => {
    const errors: string[] = []
    await use(errors)
    expect(errors, 'uncaught page errors / console errors').toEqual([])
  },

  page: async ({ page, browserErrors }, use) => {
    trackErrors(page, browserErrors)
    await use(page)
  },

  newUser: async ({ apiRequest }, use) => {
    await use(async (label = 'User') => {
      const id = uid(6).toLowerCase()
      return register(apiRequest, `${label} ${id.toUpperCase()}`, `e2e-${label.toLowerCase().replace(/\W+/g, '')}-${id}@example.test`)
    })
  },

  loginAs: async ({ apiRequest }, use) => {
    await use((email, password) => login(apiRequest, email, password))
  },

  owner: async ({ newUser }, use) => {
    await use(await newUser('Owner'))
  },

  demo: async ({ loginAs }, use) => {
    await use(await loginAs(DEMO.email))
  },

  openAs: async ({ browser, browserErrors }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (session, options = {}) => {
      const localStorage = [] as { name: string; value: string }[]
      if (session) localStorage.push({ name: 'gb-token', value: session.token })
      if (options.theme) localStorage.push({ name: 'gb-theme', value: options.theme })
      const context = await browser.newContext({
        baseURL: WEB_URL,
        storageState: { cookies: [], origins: [{ origin: WEB_URL, localStorage }] },
      })
      contexts.push(context)
      const page = await context.newPage()
      trackErrors(page, browserErrors)
      return page
    })
    for (const context of contexts) await context.close()
  },
})

export { expect }
