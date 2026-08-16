// The format gate has to tell the staged GeoPackage apart from the single-stage
// one BEFORE it compares anything to gpkg-template.schema.json. Judged against
// that schema, a perfectly good staged file collects a missing-layer error plus
// one unexpected-layer error per table, so without this branch the staged path
// is unreachable from the upload routes.

import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from './errors.js'
import { EPSG_BNG } from './geopackage-constants.js'
import {
  fullReadBuffer,
  makePolygon,
  openMemoryGp10WithSystemTables,
  registerBareFeatureBlobLayer
} from '../../../test/helpers/gpkg.js'

const { validateGpkg } = await import('./geopackage.js')

const RLB_TABLE = 'Red Line Boundary'
const GEOM_COLUMN = 'geom'

function addLayer(db, tableName, geometryTypeName) {
  registerBareFeatureBlobLayer(db, {
    tableName,
    tableGeomColumnName: GEOM_COLUMN,
    regColumnName: GEOM_COLUMN,
    geometryTypeName,
    srsId: EPSG_BNG
  })
}

/**
 * The smallest file the staged detector will accept: one habitat type present
 * on both sides, plus the red line the gate still insists on.
 *
 * @param {{ withRedLine?: boolean }} [options]
 * @returns {Buffer}
 */
function buildStagedBuffer({ withRedLine = true } = {}) {
  const db = openMemoryGp10WithSystemTables()
  try {
    if (withRedLine) {
      addLayer(db, RLB_TABLE, 'POLYGON')
      db.prepare(`INSERT INTO "${RLB_TABLE}" (${GEOM_COLUMN}) VALUES (?)`).run(
        makePolygon()
      )
    }
    addLayer(db, 'Habitats Baseline', 'MULTIPOLYGON')
    addLayer(db, 'Habitats Post-Intervention', 'MULTIPOLYGON')
    return Buffer.from(db.serialize())
  } finally {
    db.close()
  }
}

describe('validateGpkg on a staged GeoPackage', () => {
  it('accepts it and marks the result staged', () => {
    const result = validateGpkg(buildStagedBuffer())

    expect(result.valid).toBe(true)
    expect(result.staged).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('does not report the staged tables as unexpected feature layers', () => {
    // The failure this branch exists to prevent: every staged table is absent
    // from the single-stage template, so the schema comparison rejects all of them.
    const codes = validateGpkg(buildStagedBuffer()).errors.map((e) => e.code)

    expect(codes).not.toContain(ERROR_CODES.GPKG_UNEXPECTED_FEATURE_LAYER)
    expect(codes).not.toContain(ERROR_CODES.GPKG_MISSING_LAYER)
  })

  it('still requires the red line boundary', () => {
    const result = validateGpkg(buildStagedBuffer({ withRedLine: false }))

    expect(result.valid).toBe(false)
    expect(result.staged).toBe(true)
    expect(result.errors).toContainEqual({
      code: ERROR_CODES.GPKG_MISSING_LAYER,
      message: `Missing required feature layer in GeoPackage: ${RLB_TABLE}`
    })
  })

  it('leaves a single-stage file unflagged', () => {
    // `staged` is absent rather than false, so the gate's result for the
    // existing format is byte-for-byte what it always was.
    expect(validateGpkg(fullReadBuffer())).toEqual({ valid: true, errors: [] })
  })
})
