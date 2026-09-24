/** Ports of the isolated e2e stack (see playwright.config.ts). */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8491)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174)
export const API_URL = `http://localhost:${API_PORT}`
export const WEB_URL = `http://localhost:${WEB_PORT}`

/** Seeded demo accounts (backend/internal/seed). */
export const DEMO_PASSWORD = 'password123'
export const DEMO = { email: 'demo@geneboard.dev', name: 'Demo User' }
export const ALEX = { email: 'alex@geneboard.dev', name: 'Alex Rivera' }
export const SAM = { email: 'sam@geneboard.dev', name: 'Sam Patel' }
