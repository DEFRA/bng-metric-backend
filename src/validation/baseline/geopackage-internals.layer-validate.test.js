import { describe, it, expect, vi } from 'vitest'

import {
  EPSG_BNG,
  EPSG_WGS84,
  GPKG_MAGIC_BYTE_G,
  GPKG_MAGIC_BYTE_P,
  GPKG_CONTENTS_FEATURES_DATA_TYPE,
  WKB_POLYGON,
  WKB_MIN_BYTES,
  baselineSchema,
  createLayerTableDDL,
  openMemoryGp10WithSystemTables,
  insertGpkgFeatureContentsRow,
  insertGpkgGeometryColumnsRow,
  openMinimalGpkgContentsStub,
  registerBareFeatureBlobLayer
} from '../../../test/helpers/baseline-geopackage.js'

const LAYER_RLB = 'Red Line Boundary'
const LAYER_HABITATS = 'Habitats'
const LAYER_HEDGEROWS = 'Hedgerows'
const LAYER_RIVERS = 'Rivers'

const { ERROR_CODES } = await import('./errors.js')
const {
  compareOneLayerToBaselineSchema,
  validateRedLineBoundary,
  validateHabitats,
  validateHedgerows,
  validateWatercourses
} = await import('./geopackage-internals.js')

const habitatsLayer = baselineSchema.layers.find(
  (l) => l.tableName === 'Habitats'
)
const hedgerowsLayer = baselineSchema.layers.find(
  (l) => l.tableName === 'Hedgerows'
)

function compareLayerAgainstBaseline(db, layerDef, lowerTable, contentsSrs) {
  const errors = []
  compareOneLayerToBaselineSchema(
    db,
    layerDef,
    lowerTable,
    layerDef.tableName,
    { data_type: GPKG_CONTENTS_FEATURES_DATA_TYPE, srs_id: contentsSrs },
    errors
  )
  return errors
}

describe('compareOneLayerToBaselineSchema — Habitats has no geometry registration', () => {
  it('reports GPKG_HABITATS_NO_GEOMETRY_COLUMN', () => {
    const db = openMemoryGp10WithSystemTables()
    db.exec(createLayerTableDDL(habitatsLayer))
    insertGpkgFeatureContentsRow(
      db,
      habitatsLayer.tableName,
      habitatsLayer.srsId
    )

    const errors = compareLayerAgainstBaseline(
      db,
      habitatsLayer,
      'habitats',
      EPSG_BNG
    )

    expect(
      errors.some(
        (e) =>
          e.code === ERROR_CODES.GPKG_HABITATS_NO_GEOMETRY_COLUMN &&
          e.message.includes('gpkg_geometry_columns')
      )
    ).toBe(true)
    db.close()
  })
})

describe('compareOneLayerToBaselineSchema — both tables share wrong srs_id', () => {
  it('reports a single GPKG_BASELINE_SRS_ID', () => {
    const db = openMemoryGp10WithSystemTables()
    db.exec(createLayerTableDDL(habitatsLayer))
    const wrongSrs = EPSG_WGS84
    insertGpkgFeatureContentsRow(db, habitatsLayer.tableName, wrongSrs)
    insertGpkgGeometryColumnsRow(
      db,
      habitatsLayer.tableName,
      habitatsLayer.geometryColumn.name,
      habitatsLayer.geometryColumn.geometryType,
      wrongSrs
    )

    const errors = compareLayerAgainstBaseline(
      db,
      habitatsLayer,
      'habitats',
      wrongSrs
    )

    expect(
      errors.filter((e) => e.code === ERROR_CODES.GPKG_BASELINE_SRS_ID)
    ).toHaveLength(1)
    expect(
      errors.filter(
        (e) => e.code === ERROR_CODES.GPKG_BASELINE_GPKG_SRS_INCONSISTENT
      )
    ).toHaveLength(0)
    db.close()
  })
})

describe('compareOneLayerToBaselineSchema — contents vs geometry srs_id disagree', () => {
  it('reports GPKG_BASELINE_GPKG_SRS_INCONSISTENT', () => {
    const db = openMemoryGp10WithSystemTables()
    db.exec(createLayerTableDDL(habitatsLayer))
    insertGpkgFeatureContentsRow(db, habitatsLayer.tableName, EPSG_BNG)
    insertGpkgGeometryColumnsRow(
      db,
      habitatsLayer.tableName,
      habitatsLayer.geometryColumn.name,
      habitatsLayer.geometryColumn.geometryType,
      EPSG_WGS84
    )

    const errors = compareLayerAgainstBaseline(
      db,
      habitatsLayer,
      'habitats',
      EPSG_BNG
    )

    expect(
      errors.filter((e) => e.code === ERROR_CODES.GPKG_BASELINE_SRS_ID)
    ).toHaveLength(0)
    expect(
      errors.filter(
        (e) => e.code === ERROR_CODES.GPKG_BASELINE_GPKG_SRS_INCONSISTENT
      )
    ).toHaveLength(1)
    db.close()
  })
})

describe('compareOneLayerToBaselineSchema — optional layer without geometry_columns', () => {
  it('reports GPKG_BASELINE_GEOMETRY_REGISTRATION_MISSING for Hedgerows', () => {
    const db = openMemoryGp10WithSystemTables()
    db.exec(createLayerTableDDL(hedgerowsLayer))
    insertGpkgFeatureContentsRow(
      db,
      hedgerowsLayer.tableName,
      hedgerowsLayer.srsId
    )

    const errors = compareLayerAgainstBaseline(
      db,
      hedgerowsLayer,
      'hedgerows',
      EPSG_BNG
    )

    expect(
      errors.some(
        (e) =>
          e.code === ERROR_CODES.GPKG_BASELINE_GEOMETRY_REGISTRATION_MISSING &&
          e.message.includes('gpkg_geometry_columns') &&
          e.message.includes(String(hedgerowsLayer.geometryColumn.name))
      )
    ).toBe(true)
    db.close()
  })
})

describe('validateRedLineBoundary — Red Line Boundary absent', () => {
  it('returns early with no errors', () => {
    const db = openMinimalGpkgContentsStub()
    const errors = []
    validateRedLineBoundary(db, errors)
    expect(errors).toEqual([])
    db.close()
  })
})

describe('validateRedLineBoundary — big-endian WKB', () => {
  it('reads a big-endian polygon blob correctly', () => {
    const db = openMemoryGp10WithSystemTables()
    registerBareFeatureBlobLayer(db, {
      tableName: LAYER_RLB,
      regColumnName: 'geom',
      geometryTypeName: 'POLYGON'
    })

    const gpkgHeader = Buffer.from([
      GPKG_MAGIC_BYTE_G,
      GPKG_MAGIC_BYTE_P,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x00
    ])
    const wkb = Buffer.allocUnsafe(WKB_MIN_BYTES)
    wkb.writeUInt8(0, 0)
    wkb.writeUInt32BE(WKB_POLYGON, 1)
    const bigEndianPolygon = Buffer.concat([gpkgHeader, wkb])

    db.prepare(`INSERT INTO "${LAYER_RLB}" (fid, geom) VALUES (1, ?)`).run(
      bigEndianPolygon
    )

    const errors = []
    validateRedLineBoundary(db, errors)
    expect(errors).toEqual([])
    db.close()
  })
})

describe('validateRedLineBoundary — geom registration mismatch, no explicit logger', () => {
  it('does not throw when no logger is supplied and the SELECT fails', () => {
    const db = openMemoryGp10WithSystemTables()
    registerBareFeatureBlobLayer(db, {
      tableName: LAYER_RLB,
      regColumnName: 'wrong_geom',
      geometryTypeName: 'POLYGON'
    })

    const errors = []
    expect(() => validateRedLineBoundary(db, errors)).not.toThrow()
    expect(errors).toEqual([])
    db.close()
  })
})

describe('validateRedLineBoundary — geom registration mismatch vs table DDL', () => {
  it('does not throw and skips polygon counting with warn', () => {
    const db = openMemoryGp10WithSystemTables()
    registerBareFeatureBlobLayer(db, {
      tableName: LAYER_RLB,
      regColumnName: 'wrong_geom',
      geometryTypeName: 'POLYGON'
    })

    const warn = vi.fn()
    const errors = []
    validateRedLineBoundary(db, errors, { warn })

    expect(errors).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/polygon count skipped/i)
    expect(warn.mock.calls[0][0]).toMatch(/no such column/i)
    db.close()
  })
})

describe('validateHabitats — absent from contents', () => {
  it('returns early with no errors', () => {
    const db = openMinimalGpkgContentsStub()
    const errors = []
    validateHabitats(db, errors)
    expect(errors).toEqual([])
    db.close()
  })
})

describe('validateHabitats — SELECT fails after registration', () => {
  it('warns once and emits no baseline errors', () => {
    const db = openMemoryGp10WithSystemTables()
    registerBareFeatureBlobLayer(db, {
      tableName: LAYER_HABITATS,
      regColumnName: 'wrong_geom',
      geometryTypeName: 'MULTIPOLYGON'
    })

    const warn = vi.fn()
    const errors = []
    validateHabitats(db, errors, { warn })

    expect(errors).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/Habitats parcel check skipped/i)
    db.close()
  })
})

describe('validateHabitats — unsafe geometry column identifier', () => {
  it('returns without warn or baseline errors', () => {
    const db = openMemoryGp10WithSystemTables()
    registerBareFeatureBlobLayer(db, {
      tableName: LAYER_HABITATS,
      regColumnName: 'geom-bad',
      geometryTypeName: 'MULTIPOLYGON'
    })

    const warn = vi.fn()
    const errors = []
    validateHabitats(db, errors, { warn })

    expect(errors).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    db.close()
  })
})

describe('validateHedgerows — layer absent from gpkg_contents', () => {
  it('returns early with no errors when the layer is not registered', () => {
    const db = openMinimalGpkgContentsStub()
    const errors = []
    validateHedgerows(db, errors)
    expect(errors).toEqual([])
    db.close()
  })
})

describe('validateHedgerows — layer registered in contents but physical table missing', () => {
  it('returns early with no errors when countTableRows catches a missing-table error', () => {
    const db = openMemoryGp10WithSystemTables()
    insertGpkgFeatureContentsRow(
      db,
      hedgerowsLayer.tableName,
      hedgerowsLayer.srsId
    )
    // Physical table not created — countTableRows SELECT will throw and return 0

    const errors = []
    validateHedgerows(db, errors)
    expect(errors).toEqual([])
    db.close()
  })
})

describe('validateHedgerows — optional layer edge cases', () => {
  it('returns early when geometry registration is missing despite non-zero rows', () => {
    const db = openMemoryGp10WithSystemTables()
    db.exec(createLayerTableDDL(hedgerowsLayer))
    insertGpkgFeatureContentsRow(
      db,
      hedgerowsLayer.tableName,
      hedgerowsLayer.srsId
    )
    db.prepare(
      `INSERT INTO "${LAYER_HEDGEROWS}" (fid, geom) VALUES (1, ?)`
    ).run(Buffer.alloc(1))

    const warn = vi.fn()
    const errors = []
    validateHedgerows(db, errors, { warn })

    expect(errors).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    db.close()
  })

  it('returns early when the geometry column name is not a safe SQLite identifier', () => {
    const db = openMemoryGp10WithSystemTables()
    registerBareFeatureBlobLayer(db, {
      tableName: LAYER_HEDGEROWS,
      regColumnName: 'geom-bad',
      geometryTypeName: 'MULTILINESTRING'
    })
    db.prepare(
      `INSERT INTO "${LAYER_HEDGEROWS}" (fid, geom) VALUES (1, ?)`
    ).run(Buffer.alloc(1))

    const warn = vi.fn()
    const errors = []
    validateHedgerows(db, errors, { warn })

    expect(errors).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    db.close()
  })

  it('warns and skips geometry checks when the registered column does not exist', () => {
    const db = openMemoryGp10WithSystemTables()
    registerBareFeatureBlobLayer(db, {
      tableName: LAYER_HEDGEROWS,
      regColumnName: 'wrong_geom',
      geometryTypeName: 'MULTILINESTRING'
    })
    db.prepare(
      `INSERT INTO "${LAYER_HEDGEROWS}" (fid, geom) VALUES (1, ?)`
    ).run(Buffer.alloc(1))

    const warn = vi.fn()
    const errors = []
    validateHedgerows(db, errors, { warn })

    expect(errors).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/Hedgerows geometry check skipped/i)
    db.close()
  })
})

describe('validateWatercourses — optional layer edge cases', () => {
  it('returns early when geometry registration is missing despite non-zero rows', () => {
    const db = openMemoryGp10WithSystemTables()
    const riversLayer = baselineSchema.layers.find(
      (layer) => layer.tableName === LAYER_RIVERS
    )
    db.exec(createLayerTableDDL(riversLayer))
    insertGpkgFeatureContentsRow(db, riversLayer.tableName, riversLayer.srsId)
    db.prepare(`INSERT INTO "${LAYER_RIVERS}" (fid, geom) VALUES (1, ?)`).run(
      Buffer.alloc(1)
    )

    const warn = vi.fn()
    const errors = []
    validateWatercourses(db, errors, { warn })

    expect(errors).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    db.close()
  })
})
