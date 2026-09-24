import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Runs after all tests, while the servers are still up: fails the run when the e2e API logged
 * an error (a 500 `internal error`, a recovered panic, …) at any point. Browser-side checks only
 * see responses that reached a page; this also catches failures of requests the browser had
 * already abandoned.
 */
export default function globalTeardown() {
  const logFile = path.resolve(import.meta.dirname, '../.cache/api.log')
  let log: string
  try {
    log = readFileSync(logFile, 'utf8')
  } catch {
    return // the API was not started by this run (e.g. --list)
  }
  const errors = log.split('\n').filter((line) => /\blevel=ERROR\b/.test(line))
  if (errors.length > 0) {
    throw new Error(`the e2e API logged ${errors.length} error(s) (see ${logFile}):\n${errors.slice(0, 10).join('\n')}`)
  }
}
