import { describe, it, expect } from 'vitest'

import { ERROR_CODES, makeError, makeMetadataError } from './errors.js'

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

describe('makeMetadataError', () => {
  it('reports a rejected file name apart from a malformed document', () => {
    expect(
      makeMetadataError({
        message: '"filename" with value "s(1).gpkg" fails to match',
        details: [{ path: ['filename'] }]
      })
    ).toEqual({
      code: ERROR_CODES.INVALID_FILENAME,
      message: '"filename" with value "s(1).gpkg" fails to match'
    })
  })

  it.each([
    ['a feature field', [{ path: ['habitats', 0, 'status'] }]],
    ['the upload envelope', [{ path: ['fileSize'] }]],
    ['an unspecified failure', undefined],
    ['an empty details list', []],
    ['a detail with no path', [{}]],
    ['a detail with an empty path', [{ path: [] }]]
  ])('reports %s as invalid file metadata', (_description, details) => {
    expect(makeMetadataError({ message: 'is required', details })).toEqual({
      code: ERROR_CODES.INVALID_FILE_METADATA,
      message: 'is required'
    })
  })

  it('reports a file name rejected alongside other fields as a file name problem', () => {
    expect(
      makeMetadataError({
        message: 'multiple failures',
        details: [
          { path: ['habitats', 0, 'featureId'] },
          { path: ['filename'] }
        ]
      }).code
    ).toBe(ERROR_CODES.INVALID_FILENAME)
  })

  it('does not treat a nested property named filename as the uploaded file name', () => {
    expect(
      makeMetadataError({
        message: 'nested',
        details: [{ path: ['habitats', 0, 'properties', 'filename'] }]
      }).code
    ).toBe(ERROR_CODES.INVALID_FILE_METADATA)
  })
})
