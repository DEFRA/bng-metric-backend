import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ERROR_CODES, makeError } from './errors.js'

vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    throw new Error('simulated database open failure')
  }
}))

const { validateAndReadGpkg } = await import('./geopackage.js')

const INVALID_FILE = {
  valid: false,
  errors: [
    makeError(ERROR_CODES.GPKG_INVALID_FILE, 'File is not a valid GeoPackage')
  ],
  layers: null
}

/** Enough bytes to carry a SQLite header; contents beyond the magic are irrelevant. */
const SQLITE_HEADER_BYTES = 64

const stagingDir = mkdtempSync(join(tmpdir(), 'gpkg-open-failure-'))

afterAll(() => {
  rmSync(stagingDir, { recursive: true, force: true })
})

function stageFile(name, buffer) {
  const filePath = join(stagingDir, name)
  writeFileSync(filePath, buffer)
  return filePath
}

/** Minimal SQLite header — enough to pass the magic probe, nothing more. */
function makeSqliteHeaderBuffer() {
  const buf = Buffer.alloc(SQLITE_HEADER_BYTES)
  Buffer.from('SQLite format 3\0').copy(buf)
  return buf
}

describe('validateAndReadGpkg when better-sqlite3 throws while opening the database', () => {
  it('returns GPKG_INVALID_FILE for a file that is not SQLite at all', () => {
    // No SQLite magic, so the header probe rejects it before any open attempt.
    const filePath = stageFile('not-sqlite.gpkg', Buffer.alloc(16))

    expect(validateAndReadGpkg(filePath)).toEqual(INVALID_FILE)
  })

  it('returns GPKG_INVALID_FILE when the open itself fails', () => {
    // SQLite magic present, so the probe passes and the open is attempted —
    // and the failure is reported as an invalid file, not thrown.
    const filePath = stageFile('header-only.gpkg', makeSqliteHeaderBuffer())

    expect(validateAndReadGpkg(filePath)).toEqual(INVALID_FILE)
  })

  it('returns GPKG_INVALID_FILE when the file does not exist', () => {
    expect(validateAndReadGpkg(join(stagingDir, 'absent.gpkg'))).toEqual(
      INVALID_FILE
    )
  })
})
