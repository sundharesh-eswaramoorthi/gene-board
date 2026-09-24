/** Ports of the isolated e2e stack (see playwright.config.ts). */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8491)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174)
// The API listens on 127.0.0.1 only (`localhost` may resolve to ::1 first).
export const API_URL = `http://127.0.0.1:${API_PORT}`
export const WEB_URL = `http://localhost:${WEB_PORT}`

/** Seeded demo accounts (backend/internal/seed). */
export const DEMO_PASSWORD = 'password123'
export const DEMO = { email: 'demo@geneboard.dev', name: 'Demo User' }
export const ALEX = { email: 'alex@geneboard.dev', name: 'Alex Rivera' }
export const SAM = { email: 'sam@geneboard.dev', name: 'Sam Patel' }
