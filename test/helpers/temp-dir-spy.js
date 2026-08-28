// Test helper for asserting that code which creates temporary directories
// cleans them up again.
//
// The obvious approach — snapshot os.tmpdir() before and after, and diff — was
// tried first and rejected. It reads a namespace shared with every other
// process on the machine, so it silently depends on `fileParallelism: false`
// staying set, and it breaks the moment a second test runner (unit alongside
// integration, or a watch-mode process) creates a directory with the same
// prefix in the gap between the two snapshots.
//
// Worse, that assertion could not tell "created it, then cleaned it up" from
// "never created one at all" — both show up as an empty diff. Those are two
// genuinely different behaviours in downloadFileToTemp: the Content-Length
// pre-flight guard rejects BEFORE any directory exists, whereas a mid-stream
// failure must tidy up the directory it already made. Recording the actual
// mkdtemp calls lets each test say which of the two it means.
import { existsSync } from 'node:fs'
import { expect } from 'vitest'

/**
 * Wrap the real `fs/promises.mkdtemp` so every directory it hands out is
 * recorded in `created`. Intended for the factory of a partial
 * `vi.mock('node:fs/promises', ...)`, spread over the real module so every
 * other function stays untouched.
 *
 * @param {typeof import('node:fs/promises')} actual the unmocked module
 * @param {string[]} created collector the calls are pushed onto
 * @returns {(...args: unknown[]) => Promise<string>}
 */
export function recordingMkdtemp(actual, created) {
  return async (...args) => {
    const dir = await actual.mkdtemp(...args)
    created.push(dir)
    return dir
  }
}

/**
 * Run `fn`, then assert it created at least one temporary directory and left
 * none of them on disk. The "at least one" half is what stops the assertion
 * passing vacuously if the code under test stops creating directories at all.
 *
 * @param {string[]} created collector shared with {@link recordingMkdtemp}
 * @param {() => Promise<void>} fn
 */
export async function expectTempDirsCleanedUp(created, fn) {
  created.length = 0
  await fn()

  expect(created).not.toHaveLength(0)
  for (const dir of created) {
    expect(existsSync(dir)).toBe(false)
  }
}

/**
 * Run `fn`, then assert it never created a temporary directory in the first
 * place — the stronger claim, for guards that reject before touching the disk.
 *
 * @param {string[]} created collector shared with {@link recordingMkdtemp}
 * @param {() => Promise<void>} fn
 */
export async function expectNoTempDirCreated(created, fn) {
  created.length = 0
  await fn()

  expect(created).toEqual([])
}
