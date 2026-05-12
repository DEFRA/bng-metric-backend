import { describe, it, expect, vi } from 'vitest'

import { ERROR_CODES, makeError } from './errors.js'

vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    throw new Error('simulated database open failure')
  }
}))

const { validateGpkg } = await import('./geopackage.js')

describe('validateGpkg when better-sqlite3 throws while opening the buffer', () => {
  it('returns GPKG_INVALID_FILE without reaching the inner try/finally', () => {
    const result = validateGpkg(Buffer.alloc(16))

    expect(result).toEqual({
      valid: false,
      errors: [
        makeError(
          ERROR_CODES.GPKG_INVALID_FILE,
          'File is not a valid GeoPackage'
        )
      ]
    })
  })
})
