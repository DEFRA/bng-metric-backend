import { spawn } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const FIXTURE = path.join(ROOT, 'test/fixtures/watch-mode-log-transports.mjs')
const READY = /TRANSPORTS_OK (\d+)/
const CRASHED = 'this should not happen'
const RUN_TIMEOUT_MS = 20_000
const TEST_TIMEOUT_MS = 30_000

/**
 * Run the fixture under `node --watch-path`, as `npm run dev` runs the
 * backend, until it reports, crashes or times out. Watch mode never exits on
 * its own, so the process is always killed.
 *
 * @returns {Promise<{ outcome: string, transports: number, output: string }>}
 */
function runUnderWatchMode() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [`--watch-path=${FIXTURE}`, FIXTURE],
      { cwd: ROOT }
    )
    let output = ''
    const finish = (outcome) => {
      clearTimeout(timer)
      child.kill()
      resolve({
        outcome,
        transports: Number(READY.exec(output)?.[1] ?? 0),
        output
      })
    }
    const timer = setTimeout(() => finish('timed out'), RUN_TIMEOUT_MS)
    const onData = (chunk) => {
      output += chunk
      if (output.includes(CRASHED)) {
        finish('crashed')
      } else if (READY.test(output)) {
        finish('ok')
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
  })
}

describe('pino transports under watch mode', () => {
  it(
    'keep every copy of pino logging under node --watch-path',
    async () => {
      const { outcome, transports, output } = await runUnderWatchMode()

      expect(outcome, output).toBe('ok')
      expect(transports).toBeGreaterThan(0)
    },
    TEST_TIMEOUT_MS
  )
})
