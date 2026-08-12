import { describe, it, expect } from 'vitest'

import { ERROR_CODES, makeError } from './errors.js'

describe('makeError', () => {
  it('returns a code + message pair for validation payloads', () => {
    expect(
      makeError(ERROR_CODES.GPKG_INVALID_FILE, 'File is unreadable')
    ).toEqual({
      code: ERROR_CODES.GPKG_INVALID_FILE,
      message: 'File is unreadable'
    })
  })
})
