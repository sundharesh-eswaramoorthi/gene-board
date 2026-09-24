// Starts the isolated API used by the e2e suite (Playwright `webServer` command).
//
//   1. drops and recreates the e2e database (never the dev database: the name must end in "_e2e"),
//   2. builds the server binary into e2e/.cache,
//   3. applies the migrations and loads the demo seed,
//   4. runs the server in the foreground until Playwright stops it, logging to e2e/.cache/api.log.
//
// Environment (all optional):
//   E2E_DATABASE_URL  database to (re)create and serve from
//                     (default postgres://geneboard:geneboard@localhost:5442/geneboard_e2e?sslmode=disable)
//   E2E_API_PORT      API port (default 8491)
//   E2E_WEB_ORIGIN    browser origin allowed by CORS / the websocket origin check (default http://localhost:5174)
import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eDir = path.resolve(here, '..')
const backendDir = path.resolve(e2eDir, '..', 'backend')
const binDir = path.join(e2eDir, '.cache')
const bin = path.join(binDir, 'server')
const logFile = path.join(binDir, 'api.log')

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://geneboard:geneboard@localhost:5442/geneboard_e2e?sslmode=disable'
const port = process.env.E2E_API_PORT ?? '8491'
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5174'

const log = (msg) => console.log(`[e2e-api] ${msg}`)

async function recreateDatabase() {
  const url = new URL(databaseUrl)
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!/^[a-z0-9_]+_e2e$/.test(dbName)) {
    throw new Error(`refusing to recreate database "${dbName}": the e2e database name must end in "_e2e"`)
  }
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'
  const client = new pg.Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await client.query(`CREATE DATABASE ${dbName}`)
  } finally {
    await client.end()
  }
  log(`recreated database ${dbName}`)
}

function build() {
  mkdirSync(binDir, { recursive: true })
  execFileSync('go', ['build', '-o', bin, './cmd/server'], { cwd: backendDir, stdio: 'inherit' })
  log('built server binary')
}

const serverEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  // Loopback only, like the default: set explicitly so a BIND_HOST exported by the shell
  // cannot expose the API (or make it refuse the development JWT secret).
  BIND_HOST: '127.0.0.1',
  PORT: port,
  CORS_ORIGINS: webOrigin,
  // Every test registers or signs in accounts from 127.0.0.1 in quick succession: the
  // sign-in throttling would turn that into 429s.
  AUTH_RATE_LIMIT: '0',
}

await recreateDatabase()
build()
execFileSync(bin, ['migrate'], { env: serverEnv, stdio: 'inherit' })
execFileSync(bin, ['seed'], { env: serverEnv, stdio: 'inherit' })
log(`seeded; serving on 127.0.0.1:${port}`)

// The server's log goes to e2e/.cache/api.log (global teardown fails the run when the API
// logged an error: a 500 or a recovered panic). Error lines are also echoed to stderr, which
// Playwright prints, so they show up next to the test that caused them.
const logStream = createWriteStream(logFile, { flags: 'w' })
const server = spawn(bin, [], { env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] })
server.stdout.on('data', (chunk) => {
  logStream.write(chunk)
  for (const line of chunk.toString().split('\n')) {
    if (/\blevel=ERROR\b/.test(line)) process.stderr.write(`${line}\n`)
  }
})
server.stderr.on('data', (chunk) => {
  logStream.write(chunk)
  process.stderr.write(chunk)
})
const forward = (signal) => () => {
  if (server.exitCode === null) server.kill(signal)
}
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 0 : 1)))
