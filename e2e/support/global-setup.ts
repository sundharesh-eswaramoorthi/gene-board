import { chromium, request, type FullConfig } from '@playwright/test'
import { login } from './api.ts'
import { API_URL, DEMO, WEB_URL } from './env.ts'

/**
 * Runs once the API and Vite servers are up (Playwright starts `webServer`s before global setup).
 *
 * Warms the Vite dev server: the first visit to each lazily loaded page makes Vite discover and
 * pre-bundle dependencies (dnd-kit, react-markdown, …) and then force a full page reload. Doing
 * that here keeps those reloads out of the tests.
 */
export default async function globalSetup(_config: FullConfig) {
  const ctx = await request.newContext()
  const health = await ctx.get(`${API_URL}/api/health`)
  if (!health.ok()) throw new Error(`e2e API not healthy: ${health.status()}`)
  const demo = await login(ctx, DEMO.email)
  await ctx.dispose()

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      baseURL: WEB_URL,
      storageState: { cookies: [], origins: [{ origin: WEB_URL, localStorage: [{ name: 'gb-token', value: demo.token }] }] },
    })
    const page = await context.newPage()
    const routes = [
      '/',
      '/projects',
      '/issues',
      '/projects/GB/board',
      '/projects/GB/backlog',
      '/projects/GB/epics',
      '/projects/GB/issues',
      '/projects/GB/activity',
      '/projects/GB/settings',
      '/projects/GB/board?issue=GB-1',
      '/browse/GB-2',
      '/projects/OPS/board',
    ]
    // Two passes: the first may be interrupted by Vite's "optimized dependencies changed" reloads.
    for (let pass = 0; pass < 2; pass++) {
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'load', timeout: 120_000 })
        await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
      }
    }
    await context.close()
  } finally {
    await browser.close()
  }
}
