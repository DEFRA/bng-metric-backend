import { describe, it, expect } from 'vitest'

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  ERROR_CODES,
  ERROR_CODE_SURFACES,
  ERROR_SURFACES,
  makeError,
  makeMetadataError
} from './errors.js'

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

  it('reports a file name that exceeds the length limit as FILENAME_TOO_LONG', () => {
    expect(
      makeMetadataError({
        message:
          '"filename" length must be less than or equal to 255 characters long',
        details: [{ path: ['filename'], type: 'string.max' }]
      })
    ).toEqual({
      code: ERROR_CODES.FILENAME_TOO_LONG,
      message:
        '"filename" length must be less than or equal to 255 characters long'
    })
  })

  it('prefers FILENAME_TOO_LONG when length and pattern both fail', () => {
    expect(
      makeMetadataError({
        message: 'multiple filename failures',
        details: [
          { path: ['filename'], type: 'string.max' },
          { path: ['filename'], type: 'string.pattern.base' }
        ]
      }).code
    ).toBe(ERROR_CODES.FILENAME_TOO_LONG)
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

describe('ERROR_CODE_SURFACES', () => {
  const ROUTES = path.join(import.meta.dirname, '..', '..', 'routes')
  // The helpers the edit routes refuse a change with.
  const EDIT_ERROR_HELPERS = [
    'ref-in-use-error.js',
    'invalid-enhancement-error.js',
    'out-of-scope-error.js'
  ]

  it('gives every code at least one surface, and no other', () => {
    expect(Object.keys(ERROR_CODE_SURFACES).sort()).toEqual(
      Object.values(ERROR_CODES).sort()
    )
    const known = Object.values(ERROR_SURFACES)
    for (const [code, surfaces] of Object.entries(ERROR_CODE_SURFACES)) {
      expect(surfaces.length, code).toBeGreaterThan(0)
      expect(
        surfaces.every((s) => known.includes(s)),
        code
      ).toBe(true)
    }
  })

  it.each(EDIT_ERROR_HELPERS)(
    'counts the code %s refuses an edit with as an edit code',
    (helper) => {
      const source = readFileSync(path.join(ROUTES, helper), 'utf8')
      const [, code] = /ERROR_CODES\.([A-Z0-9_]+)/.exec(source)
      expect(ERROR_CODE_SURFACES[code]).toContain(ERROR_SURFACES.EDIT)
    }
  )

  it('keeps edit-only codes off the drop-out page, and the rest on it', () => {
    expect(ERROR_CODE_SURFACES.HABITAT_REF_IN_USE).toEqual([
      ERROR_SURFACES.EDIT
    ])
    expect(ERROR_CODE_SURFACES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE).toEqual([
      ERROR_SURFACES.UPLOAD,
      ERROR_SURFACES.EDIT
    ])
    expect(ERROR_CODE_SURFACES.PARCEL_OVERLAPS).toEqual([ERROR_SURFACES.UPLOAD])
  })
})
