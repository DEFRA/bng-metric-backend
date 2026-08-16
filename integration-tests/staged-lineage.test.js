// End-to-end spike: read a staged GeoPackage produced by the BNG Service QGIS
// template, derive baseline → post-intervention lineage, and reconcile.
//
// The fixture is a real export from that template, not a synthetic one, so this
// exercises the actual column names and geometry the surveyor workflow emits.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

import { deriveLineage } from '../src/validation/geopackage/lineage/derive-lineage.js'
import { readStagedGeoPackage } from '../src/validation/geopackage/lineage/read-staged-geopackage.js'
import {
  RECONCILIATION_POLICY,
  reconcileSize,
  requiresContainment
} from '../src/validation/geopackage/lineage/reconcile.js'
import { HABITAT_TYPES } from '../src/validation/geopackage/lineage/staged-layer-names.js'
import { getDbConfig } from './helpers/db.js'

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'staged-baseline-and-pi.gpkg'
)

const POND_AREA_SQ_M = 2500
const PARCEL_AREA_SQ_M = 10_000
const SHARE_EACH_SQ_M = 1250
const TOLERANCE_SQ_M = 0.5

const pool = new pg.Pool(getDbConfig())
let staged

beforeAll(() => {
  staged = readStagedGeoPackage(FIXTURE)
})

afterAll(async () => {
  await pool.end().catch(() => {})
})

describe('reading a staged GeoPackage', () => {
  it('recognises it as staged', () => {
    expect(staged.staged).toBe(true)
  })

  it('separates baseline from post-intervention', () => {
    expect(staged.baseline[HABITAT_TYPES.AREAS]).toHaveLength(2)
    expect(staged.postIntervention[HABITAT_TYPES.AREAS]).toHaveLength(3)
    expect(staged.baseline[HABITAT_TYPES.WATERCOURSES]).toHaveLength(1)
    expect(staged.postIntervention[HABITAT_TYPES.WATERCOURSES]).toHaveLength(1)
  })

  it('reads the red line', () => {
    expect(staged.redline).toHaveLength(1)
  })

  it('carries lineage columns through', () => {
    const pi = staged.postIntervention[HABITAT_TYPES.AREAS]
    const stamped = pi.filter((f) => f.parentRef)
    const unstamped = pi.filter((f) => !f.parentRef)
    expect(stamped.map((f) => f.parentRef).sort()).toEqual(['PR-1', 'PR-2'])
    // the pond was drawn fresh, so it has no stamped parent
    expect(unstamped).toHaveLength(1)
    expect(unstamped[0].piRef).toBe('PI-POND')
    expect(unstamped[0].retentionCategory).toBe('Created')
  })
})

describe('deriving lineage', () => {
  it('trusts the stamped Parent Ref without touching geometry', async () => {
    const result = await deriveLineage(
      pool,
      staged.postIntervention[HABITAT_TYPES.AREAS],
      staged.baseline[HABITAT_TYPES.AREAS]
    )
    const stamped = result.filter((r) => r.source === 'stamped')
    expect(stamped).toHaveLength(2)
    for (const entry of stamped) {
      expect(entry.parents).toHaveLength(1)
      expect(entry.parents[0].share).toBe(1)
    }
  })

  it('apportions the straddling pond across both parents by area', async () => {
    const result = await deriveLineage(
      pool,
      staged.postIntervention[HABITAT_TYPES.AREAS],
      staged.baseline[HABITAT_TYPES.AREAS]
    )
    const pond = result.find((r) => r.piRef === 'PI-POND')
    expect(pond.source).toBe('geometry')
    expect(pond.parents).toHaveLength(2)

    const byRef = Object.fromEntries(
      pond.parents.map((p) => [p.ref, p.sharedSize])
    )
    expect(byRef['PR-1']).toBeCloseTo(SHARE_EACH_SQ_M, 1)
    expect(byRef['PR-2']).toBeCloseTo(SHARE_EACH_SQ_M, 1)

    const total = pond.parents.reduce((sum, p) => sum + p.sharedSize, 0)
    expect(total).toBeCloseTo(POND_AREA_SQ_M, 1)
    expect(pond.parents.every((p) => p.share === 0.5)).toBe(true)
  })

  it('does not attribute parentage to a merely adjacent parcel', async () => {
    // The trap: every post-intervention parcel here TOUCHES both baseline
    // parcels, so a bare ST_Intersects would give each of them two parents.
    // Area weighting must resolve each trimmed parcel to exactly one.
    const unstamped = staged.postIntervention[HABITAT_TYPES.AREAS].map((f) => ({
      ...f,
      parentRef: null // force the geometry path for all three
    }))
    const result = await deriveLineage(
      pool,
      unstamped,
      staged.baseline[HABITAT_TYPES.AREAS]
    )
    const trimmed = result.filter((r) => r.piRef !== 'PI-POND')
    expect(trimmed).toHaveLength(2)
    for (const entry of trimmed) {
      expect(entry.parents).toHaveLength(1)
      expect(entry.parents[0].ref).toBe(entry.piRef)
      expect(entry.parents[0].sharedSize).toBeCloseTo(
        PARCEL_AREA_SQ_M - SHARE_EACH_SQ_M,
        1
      )
    }
  })

  it('leaves a feature parentless when nothing overlaps', async () => {
    const orphan = [
      {
        piRef: 'ORPHAN',
        parentRef: null,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [900, 900],
              [910, 900],
              [910, 910],
              [900, 910],
              [900, 900]
            ]
          ]
        }
      }
    ]
    const result = await deriveLineage(
      pool,
      orphan,
      staged.baseline[HABITAT_TYPES.AREAS]
    )
    expect(result[0].source).toBe('none')
    expect(result[0].parents).toEqual([])
  })
})

describe('reconciliation is per habitat type', () => {
  it('area habitats must balance, and do', async () => {
    const result = await reconcileSize(
      pool,
      HABITAT_TYPES.AREAS,
      staged.baseline[HABITAT_TYPES.AREAS],
      staged.postIntervention[HABITAT_TYPES.AREAS]
    )
    expect(result.checked).toBe(true)
    expect(result.baselineTotal).toBeCloseTo(2 * PARCEL_AREA_SQ_M, 1)
    expect(result.piTotal).toBeCloseTo(2 * PARCEL_AREA_SQ_M, 1)
    expect(Math.abs(result.delta)).toBeLessThanOrEqual(TOLERANCE_SQ_M)
    expect(result.withinTolerance).toBe(true)
  })

  it('watercourses are exempt — realignment lengthens the channel', async () => {
    const result = await reconcileSize(
      pool,
      HABITAT_TYPES.WATERCOURSES,
      staged.baseline[HABITAT_TYPES.WATERCOURSES],
      staged.postIntervention[HABITAT_TYPES.WATERCOURSES]
    )
    expect(result.checked).toBe(false)
    expect(result.reason).toMatch(/realignment/i)
  })

  it('the realigned channel would fail an equal-length rule', async () => {
    // proving the exemption is load-bearing rather than cosmetic
    const [base] = staged.baseline[HABITAT_TYPES.WATERCOURSES]
    const [pi] = staged.postIntervention[HABITAT_TYPES.WATERCOURSES]
    const { rows } = await pool.query(
      `SELECT ST_Length(ST_GeomFromGeoJSON($1)) AS base_len,
              ST_Length(ST_GeomFromGeoJSON($2)) AS pi_len,
              ST_Length(ST_Difference(ST_GeomFromGeoJSON($2),
                                      ST_GeomFromGeoJSON($1))) AS off_line`,
      [JSON.stringify(base.geometry), JSON.stringify(pi.geometry)]
    )
    const { base_len: baseLen, pi_len: piLen, off_line: offLine } = rows[0]
    expect(Number(piLen)).toBeGreaterThan(Number(baseLen))
    expect(Number(offLine)).toBeGreaterThan(0)
  })

  it('containment applies to areas and hedgerows but not watercourses or trees', () => {
    expect(requiresContainment(HABITAT_TYPES.AREAS)).toBe(true)
    expect(requiresContainment(HABITAT_TYPES.VERTICAL_AREAS)).toBe(true)
    expect(requiresContainment(HABITAT_TYPES.HEDGEROWS)).toBe(true)
    expect(requiresContainment(HABITAT_TYPES.WATERCOURSES)).toBe(false)
    expect(requiresContainment(HABITAT_TYPES.TREES)).toBe(false)
  })

  it('every habitat type has a policy', () => {
    for (const type of Object.values(HABITAT_TYPES)) {
      expect(RECONCILIATION_POLICY[type]).toBeDefined()
    }
  })
})
