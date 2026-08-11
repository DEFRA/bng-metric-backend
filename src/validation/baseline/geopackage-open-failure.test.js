import { describe, it, expect, vi } from 'vitest'

import { ERROR_CODES, makeError } from './errors.js'

vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    throw new Error('simulated database open failure')
  }
}))

const { validateGpkg } = await import('./geopackage.js')

const INVALID_FILE = {
  valid: false,
  errors: [
    makeError(ERROR_CODES.GPKG_INVALID_FILE, 'File is not a valid GeoPackage')
  ]
}

/** Minimal SQLite header; read/write version 1 = rollback journal (not WAL). */
function makeSqliteHeaderBuffer() {
  const buf = Buffer.alloc(64)
  Buffer.from('SQLite format 3\0').copy(buf)
  buf[18] = 1
  buf[19] = 1
  return buf
}

describe('validateGpkg when better-sqlite3 throws while opening the database', () => {
  it('returns GPKG_INVALID_FILE for a non-SQLite buffer without staging to disk', () => {
    // Buffer.alloc(16) has no SQLite magic, so after the in-memory open
    // throws, validateGpkg rejects immediately rather than falling through
    // to the disk-staging path.
    expect(validateGpkg(Buffer.alloc(16))).toEqual(INVALID_FILE)
  })

  it('returns GPKG_INVALID_FILE when staging open also fails for a SQLite header', () => {
    // SQLite magic + non-WAL version: in-memory open throws, then the safety
    // net stages to disk and open throws again → INVALID_FILE.
    expect(validateGpkg(makeSqliteHeaderBuffer())).toEqual(INVALID_FILE)
  })
})
