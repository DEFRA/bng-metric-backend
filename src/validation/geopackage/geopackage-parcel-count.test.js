import { describe, it, expect } from 'vitest'

import {
  RLB_LYR,
  HABITATS_LYR,
  HEDGEROWS_LYR,
  RIVERS_LYR
} from './geopackage-constants.js'
import { ERROR_CODES } from './errors.js'
import { validateParcelCount } from './geopackage-internals-validate-features.js'
import { validateGpkg, validateAndReadGpkgFile } from './geopackage.js'
import {
  fullReadBuffer,
  readTestMultiPolygonWkb,
  withTempGpkgFile,
  wrapGpkgWkb
} from '../../../test/helpers/gpkg.js'

/** Counted layers in fullReadBuffer(): RLB, Habitats, Hedgerows, Rivers. */
const FULL_READ_COUNTED = 4

/** fullReadBuffer() also carries one Urban Tree, which is NOT counted. */
const FULL_READ_UNCOUNTED = 1

/** Only `rowCount` is read, so a table needs nothing else. */
function tables(counts) {
  return new Map(
    Object.entries(counts).map(([key, rowCount]) => [key, { rowCount }])
  )
}

function habitatFeatures(count) {
  return Array.from({ length: count }, () =>
    wrapGpkgWkb(readTestMultiPolygonWkb())
  )
}

describe('validateParcelCount', () => {
  it('sums rows across the boundary, habitat, hedgerow and watercourse layers', () => {
    const errors = []

    validateParcelCount(
      tables({
        [RLB_LYR]: 1,
        [HABITATS_LYR]: 12000,
        [HEDGEROWS_LYR]: 4000,
        [RIVERS_LYR]: 800
      }),
      errors,
      16801
    )

    // 16,801 exactly — the largest fixture in the repo, and at the limit.
    expect(errors).toEqual([])
  })

  it('rejects one row over the limit, naming both numbers', () => {
    const errors = []

    validateParcelCount(tables({ [HABITATS_LYR]: 25001 }), errors, 25000)

    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe(ERROR_CODES.GPKG_TOO_MANY_PARCELS)
    expect(errors[0].message).toContain('25,001')
    expect(errors[0].message).toContain('25,000')
  })

  it('counts a layer the file does not have as zero rather than failing', () => {
    const errors = []

    validateParcelCount(tables({ [HABITATS_LYR]: 5 }), errors, 10)

    expect(errors).toEqual([])
  })

  // Zero is the documented off switch, and it has to beat any file size —
  // otherwise disabling the check would refuse everything instead.
  it('is disabled by a limit of zero', () => {
    const errors = []

    validateParcelCount(tables({ [HABITATS_LYR]: 1_000_000 }), errors, 0)

    expect(errors).toEqual([])
  })

  it('is disabled by a limit that is not a positive number', () => {
    for (const limit of [-1, undefined, null, Number.NaN]) {
      const errors = []
      validateParcelCount(tables({ [HABITATS_LYR]: 1_000_000 }), errors, limit)
      expect(errors).toEqual([])
    }
  })
})

describe('the format gate enforces the parcel limit', () => {
  it('accepts a file on the limit', () => {
    const result = validateGpkg(fullReadBuffer(), FULL_READ_COUNTED)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects a file over it, before any shape is unpacked', () => {
    const result = validateGpkg(fullReadBuffer(), FULL_READ_COUNTED - 1)

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain(
      ERROR_CODES.GPKG_TOO_MANY_PARCELS
    )
  })

  it('does not count layers outside the four it names', () => {
    // The file carries an Urban Tree as well. A limit set to the counted total
    // must still admit it, or the limit would mean something other than it says.
    const result = validateGpkg(
      fullReadBuffer(),
      FULL_READ_COUNTED + FULL_READ_UNCOUNTED - 1
    )

    expect(result.valid).toBe(true)
  })

  // The cheap classify gate and the full gate-and-read have to reach the same
  // verdict, or a file would be rejected on one path and accepted on the other.
  it('reaches the same verdict on both read paths', async () => {
    const buffer = fullReadBuffer({ Habitats: habitatFeatures(3) })
    const limit = FULL_READ_COUNTED

    const classify = validateGpkg(buffer, limit)
    const full = await withTempGpkgFile(buffer, (filePath) =>
      validateAndReadGpkgFile(filePath, limit)
    )

    expect(classify.valid).toBe(false)
    expect(full.valid).toBe(false)
    expect(full.errors.map((e) => e.code)).toEqual(
      classify.errors.map((e) => e.code)
    )
  })
})
