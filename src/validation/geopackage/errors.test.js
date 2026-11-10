import { describe, it, expect } from 'vitest'

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  ERROR_CODES,
  ERROR_CODE_DETAILS,
  ERROR_CODE_SURFACES,
  ERROR_SURFACES,
  makeError,
  makeMetadataError,
  withVariant
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

describe('withVariant', () => {
  it('adds a variant to an error with no details', () => {
    expect(withVariant(makeError('CODE', 'msg'), 'named')).toEqual({
      code: 'CODE',
      message: 'msg',
      details: { variants: ['named'] }
    })
  })

  it('keeps the details and the variants already there', () => {
    const error = makeError('CODE', 'msg', { layer: 'L', variants: ['a'] })
    expect(withVariant(error, 'b').details).toEqual({
      layer: 'L',
      variants: ['a', 'b']
    })
  })
})

describe('ERROR_CODE_DETAILS', () => {
  // The harness's check reads these names, so a typo here would hold the
  // frontend's error text to the wrong ones.
  it('names only codes the backend defines, each with values or variants', () => {
    const codes = new Set(Object.values(ERROR_CODES))
    for (const [code, entry] of Object.entries(ERROR_CODE_DETAILS)) {
      expect(codes.has(code), code).toBe(true)
      for (const key of Object.keys(entry)) {
        expect(['values', 'variants'], `${code}.${key}`).toContain(key)
      }
      const names = [...(entry.values ?? []), ...(entry.variants ?? [])]
      expect(names.length, code).toBeGreaterThan(0)
      expect(new Set(names).size, code).toBe(names.length)
    }
  })

  it('names none of the keys a list error carries for its habitats', () => {
    for (const [code, { values = [] }] of Object.entries(ERROR_CODE_DETAILS)) {
      for (const reserved of ['count', 'sample', 'variants']) {
        expect(values, `${code}: ${reserved}`).not.toContain(reserved)
      }
    }
  })
})

describe('ERROR_CODE_SURFACES', () => {
  const ROUTES = path.join(import.meta.dirname, '..', '..', 'routes')
  // The helpers the edit routes refuse a change with.
  const EDIT_ERROR_HELPERS = [
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

  // The map is keyed by each code's value, so the test names one by its key
  // only because the two are the same.
  it("keeps every code's value the same as its key", () => {
    for (const [name, value] of Object.entries(ERROR_CODES)) {
      expect(value, name).toBe(name)
    }
  })

  it.each(EDIT_ERROR_HELPERS)(
    'counts every code %s refuses an edit with as an edit code',
    (helper) => {
      const source = readFileSync(path.join(ROUTES, helper), 'utf8')
      const names = [...source.matchAll(/ERROR_CODES\.([A-Z0-9_]+)/g)].map(
        ([, name]) => name
      )
      // A helper that stops naming its code this way fails here, by name,
      // rather than with a TypeError.
      expect(names.length, `${helper} names no ERROR_CODES`).toBeGreaterThan(0)
      for (const name of names) {
        expect(ERROR_CODE_SURFACES[ERROR_CODES[name]], name).toContain(
          ERROR_SURFACES.EDIT
        )
      }
    }
  )

  it('keeps edit-only codes off the drop-out page, and the rest on it', () => {
    expect(ERROR_CODE_SURFACES.ENHANCEMENT_NOT_VALID).toEqual([
      ERROR_SURFACES.EDIT
    ])
    expect(ERROR_CODE_SURFACES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE).toEqual([
      ERROR_SURFACES.UPLOAD,
      ERROR_SURFACES.EDIT
    ])
    expect(ERROR_CODE_SURFACES.PARCEL_OVERLAPS).toEqual([ERROR_SURFACES.UPLOAD])
  })
})
