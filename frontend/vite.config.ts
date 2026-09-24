import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

/**
 * Backend origin; override with GB_API_URL (e.g. to point at a mock or remote API). The API
 * listens on 127.0.0.1 only, so the default names that address: `localhost` may resolve to ::1
 * first (macOS), which the API does not listen on.
 */
const apiTarget = process.env.GB_API_URL ?? 'http://127.0.0.1:8484'

/** Everything under /api (REST + the project websocket) goes to the Go backend. */
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
    ws: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  // GB_VITE_CACHE_DIR lets a second dev server (the e2e suite's) keep its own dependency
  // pre-bundle cache instead of rewriting node_modules/.vite under a running `npm run dev`.
  cacheDir: process.env.GB_VITE_CACHE_DIR,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks for the app shell. Libraries only used by lazily loaded
        // feature pages (markdown, dnd-kit) are left to automatic splitting so they load on demand.
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 30 },
            { name: 'radix', test: /[\\/]node_modules[\\/](radix-ui|@radix-ui|@floating-ui)[\\/]/, priority: 20 },
            { name: 'query', test: /[\\/]node_modules[\\/]@tanstack[\\/]/, priority: 20 },
            {
              name: 'vendor',
              priority: 10,
              test: (id) =>
                /[\\/]node_modules[\\/]/.test(id) &&
                !/[\\/]node_modules[\\/](@dnd-kit|react-markdown|remark-|micromark|mdast-|hast-|unist-|unified|vfile)/.test(id),
            },
          ],
        },
      },
    },
  },
})
