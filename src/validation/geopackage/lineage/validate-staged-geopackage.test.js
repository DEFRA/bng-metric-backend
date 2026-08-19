// Brand-new habitats at post-intervention only — planted hedgerows, new trees,
// new watercourses — carry Retention Category "Created" and NO parent stamp,
// because nothing at baseline precedes them. These tests pin down that the
// staged validation accepts such rows, and that the missing-baseline error
// still fires for continuing (Retained/Enhanced) rows, which genuinely cannot
// exist without a baseline counterpart.
//
// No database: the pg pool is faked with a dispatcher that recognises each of
// the validator's SQL shapes and computes planar sizes in JS. The staged files
// are built on the fly with the same gpkg-io helpers the fixtures use.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  gpkgLineString,
  gpkgPoint,
  openGeoPackage,
  registerLayer
} from 'bng-library/gpkg-io'
import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { EPSG_BNG } from '../geopackage-constants.js'
import { fakeStagedPool } from './staged-fake-pool.test-fixtures.js'
import { validateStagedGeoPackage } from './validate-staged-geopackage.js'

const BNG_SRS = {
  srsId: EPSG_BNG,
  name: 'OSGB36 / British National Grid',
  organization: 'EPSG',
  organizationCoordsysId: EPSG_BNG,
  definition: 'PROJCS["OSGB36 / British National Grid"]'
}

// ---------------------------------------------------------------------------
// Minimal staged GeoPackage builders
// ---------------------------------------------------------------------------

const HEDGE_DDL = `(
  fid INTEGER PRIMARY KEY,
  geom BLOB,
  "Parcel Ref" TEXT,
  "PI Ref" TEXT,
  "Parent Ref" TEXT,
  "Retention Category" TEXT,
  "Length" REAL,
  feature_uuid TEXT,
  parent_uuid TEXT,
  parent_checksum TEXT
)`

const TREE_DDL = `(
  fid INTEGER PRIMARY KEY,
  geom BLOB,
  "Tree Ref" TEXT,
  "PI Ref" TEXT,
  "Parent Ref" TEXT,
  "Retention Category" TEXT,
  "Count" INTEGER,
  feature_uuid TEXT,
  parent_uuid TEXT,
  parent_checksum TEXT
)`

/**
 * Build a throwaway staged GeoPackage from layer specs, run the validator
 * over it with a fake pool, and clean up.
 *
 * @param {Array<{ name: string, geomType: string, ddl: string, insert: string, rows: unknown[][] }>} layers
 * @returns {Promise<{ result: object, pool: { calls: string[] } }>}
 */
async function validateBuiltGpkg(layers) {
  const dir = mkdtempSync(path.join(tmpdir(), 'staged-unit-'))
  const filePath = path.join(dir, 'staged.gpkg')
  const db = openGeoPackage(filePath, { srs: [BNG_SRS] })
  try {
    for (const layer of layers) {
      db.exec(`CREATE TABLE "${layer.name}" ${layer.ddl}`)
      registerLayer(db, layer.name, layer.geomType, null, EPSG_BNG, 'geom')
      const statement = db.prepare(
        `INSERT INTO "${layer.name}" ${layer.insert}`
      )
      for (const row of layer.rows) {
        statement.run(...row)
      }
    }
  } finally {
    db.close()
  }
  const pool = fakeStagedPool()
  try {
    const result = await validateStagedGeoPackage(filePath, pool)
    return { result, pool }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const HEDGE_INSERT = `(geom, "Parcel Ref", "PI Ref", "Parent Ref", "Retention Category", "Length", feature_uuid, parent_uuid)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
const TREE_INSERT = `(geom, "Tree Ref", "PI Ref", "Parent Ref", "Retention Category", "Count", feature_uuid, parent_uuid)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

const HR1_UUID = '4dc7c07a-0000-4000-8000-000000000001'
const WC1_UUID = '4dc7c07a-0000-4000-8000-000000000002'
const WC2_UUID = '4dc7c07a-0000-4000-8000-000000000003'

/** Baseline hedge HR-1: 200 m along y=300. */
const HR1_LINE = gpkgLineString(EPSG_BNG, [
  [0, 300],
  [200, 300]
])
/** Retained child HR-1a: the western 100 m of HR-1. */
const HR1A_LINE = gpkgLineString(EPSG_BNG, [
  [0, 300],
  [100, 300]
])
/** Brand-new hedge, planted away from any baseline feature. */
const HR_NEW_LINE = gpkgLineString(EPSG_BNG, [
  [20, 400],
  [170, 400]
])

function hedgerowLayers({ includeBaseline = true, baselineRows, piRows }) {
  const layers = []
  if (includeBaseline) {
    layers.push({
      name: 'Hedgerows Baseline',
      geomType: 'LINESTRING',
      ddl: HEDGE_DDL,
      insert: HEDGE_INSERT,
      rows: baselineRows
    })
  }
  layers.push({
    name: 'Hedgerows Post-Intervention',
    geomType: 'LINESTRING',
    ddl: HEDGE_DDL,
    insert: HEDGE_INSERT,
    rows: piRows
  })
  return layers
}

function treeLayers({ includeBaseline = true, baselineRows = [], piRows }) {
  const layers = []
  if (includeBaseline) {
    layers.push({
      name: 'Trees Baseline',
      geomType: 'POINT',
      ddl: TREE_DDL,
      insert: TREE_INSERT,
      rows: baselineRows
    })
  }
  layers.push({
    name: 'Trees Post-Intervention',
    geomType: 'POINT',
    ddl: TREE_DDL,
    insert: TREE_INSERT,
    rows: piRows
  })
  return layers
}

function errorFor(result, code) {
  return result.errors.find((error) => error.code === code)
}

function warningFor(result, code) {
  return (result.warnings ?? []).find((warning) => warning.code === code)
}

// ---------------------------------------------------------------------------

describe('parentless Created rows alongside normal stamped rows', () => {
  async function validateHedgeWithNewPlanting() {
    return validateBuiltGpkg(
      hedgerowLayers({
        baselineRows: [
          [HR1_LINE, 'HR-1', null, null, null, 200, HR1_UUID, null]
        ],
        piRows: [
          [HR1A_LINE, null, 'HR-1a', 'HR-1', 'Retained', 100, null, HR1_UUID],
          [HR_NEW_LINE, null, 'HR-NEW-1', null, 'Created', 150, null, null]
        ]
      })
    )
  }

  it('accepts the file with no unknown-parent error', async () => {
    const { result } = await validateHedgeWithNewPlanting()

    expect(errorFor(result, ERROR_CODES.STAGED_UNKNOWN_PARENT_REF)).toBe(
      undefined
    )
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('emits no inferred-parent or drift warning for the new planting', async () => {
    const { result } = await validateHedgeWithNewPlanting()

    expect(warningFor(result, ERROR_CODES.STAGED_PARENT_INFERRED)).toBe(
      undefined
    )
    expect(warningFor(result, ERROR_CODES.STAGED_BASELINE_DRIFTED)).toBe(
      undefined
    )
  })

  it('leaves the SHORTFALL sums untouched by the new planting', async () => {
    // HR-1 is 200 m with a single 100 m Retained child: exactly 100 m removed.
    // The 150 m Created hedge must not count towards any parent.
    const { result } = await validateHedgeWithNewPlanting()

    expect(result.removed).toHaveLength(1)
    expect(result.removed[0]).toMatchObject({
      type: 'hedgerows',
      parent_ref: 'HR-1',
      measure: 'length'
    })
    expect(result.removed[0].baseline_size).toBeCloseTo(200, 6)
    expect(result.removed[0].pi_size).toBeCloseTo(100, 6)
    expect(result.removed[0].removed_size).toBeCloseTo(100, 6)
    expect(errorFor(result, ERROR_CODES.STAGED_PARENT_OVERSUBSCRIBED)).toBe(
      undefined
    )
  })
})

describe('a habitat type recorded at post-intervention only', () => {
  const CREATED_TREE = [
    gpkgPoint(EPSG_BNG, 50, 50),
    null,
    'T-NEW-1',
    null,
    'Created',
    1,
    null,
    null
  ]
  const RETAINED_TREE = [
    gpkgPoint(EPSG_BNG, 60, 60),
    null,
    'T-1a',
    null,
    'Retained',
    1,
    null,
    null
  ]

  it('accepts Created trees when the Trees Baseline layer is absent', async () => {
    const { result } = await validateBuiltGpkg(
      treeLayers({ includeBaseline: false, piRows: [CREATED_TREE] })
    )

    expect(errorFor(result, ERROR_CODES.STAGED_MISSING_BASELINE_LAYER)).toBe(
      undefined
    )
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('accepts Created trees when the Trees Baseline layer is present but empty', async () => {
    const { result } = await validateBuiltGpkg(
      treeLayers({ baselineRows: [], piRows: [CREATED_TREE] })
    )

    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('still rejects Retained rows whose baseline layer is absent', async () => {
    const { result } = await validateBuiltGpkg(
      treeLayers({
        includeBaseline: false,
        piRows: [CREATED_TREE, RETAINED_TREE]
      })
    )

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_MISSING_BASELINE_LAYER)
    expect(error.details.sample).toEqual([{ type: 'trees' }])
  })

  it('rejects Retained rows whose baseline layer is present but empty', async () => {
    const { result } = await validateBuiltGpkg(
      treeLayers({ baselineRows: [], piRows: [RETAINED_TREE] })
    )

    expect(result.valid).toBe(false)
    const error = errorFor(result, ERROR_CODES.STAGED_MISSING_BASELINE_LAYER)
    expect(error.details.sample).toEqual([{ type: 'trees' }])
  })
})

describe('parentless Created watercourses and PRESENCE removal detection', () => {
  /** Baseline channel WC-1: 100 m along y=100, continued by a stamped child. */
  const WC1_LINE = gpkgLineString(EPSG_BNG, [
    [0, 100],
    [100, 100]
  ])
  /** Baseline channel WC-2: 80 m along y=150, with NO child — removed. */
  const WC2_LINE = gpkgLineString(EPSG_BNG, [
    [0, 150],
    [80, 150]
  ])
  /** WC-1's stamped Enhanced child, re-meandered but present. */
  const WC1A_LINE = gpkgLineString(EPSG_BNG, [
    [0, 100],
    [120, 100]
  ])
  /** A brand-new channel with no baseline counterpart. */
  const WC_NEW_LINE = gpkgLineString(EPSG_BNG, [
    [0, 200],
    [90, 200]
  ])

  it('keeps removal-by-absence exact in the presence of a new channel', async () => {
    const { result } = await validateBuiltGpkg([
      {
        name: 'Watercourses Baseline',
        geomType: 'LINESTRING',
        ddl: HEDGE_DDL,
        insert: HEDGE_INSERT,
        rows: [
          [WC1_LINE, 'WC-1', null, null, null, 100, WC1_UUID, null],
          [WC2_LINE, 'WC-2', null, null, null, 80, WC2_UUID, null]
        ]
      },
      {
        name: 'Watercourses Post-Intervention',
        geomType: 'LINESTRING',
        ddl: HEDGE_DDL,
        insert: HEDGE_INSERT,
        rows: [
          [WC1A_LINE, null, 'WC-1a', 'WC-1', 'Enhanced', 120, null, WC1_UUID],
          [WC_NEW_LINE, null, 'WC-NEW-1', null, 'Created', 90, null, null]
        ]
      }
    ])

    expect(result.valid).toBe(true)
    // WC-2 alone is removed: the Created channel neither vouches for a parent
    // it does not have, nor hides the loss of one that has no children.
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0]).toMatchObject({
      type: 'watercourses',
      parent_ref: 'WC-2',
      measure: 'length'
    })
    expect(result.removed[0].removed_size).toBeCloseTo(80, 6)
  })
})
