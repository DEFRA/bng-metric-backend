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
  reconcileParents,
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
const VERTICAL_FOOTPRINT_M = 50
const HEDGE_TOTAL_M = 200
const HEDGE_HALF_M = 100

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

describe('vertical area habitats', () => {
  it('reads as a line with a hand-entered Area', () => {
    const base = staged.baseline[HABITAT_TYPES.VERTICAL_AREAS]
    const pi = staged.postIntervention[HABITAT_TYPES.VERTICAL_AREAS]
    expect(base).toHaveLength(1)
    expect(pi).toHaveLength(1)
    expect(base[0].geometry.type).toBe('LineString')
    expect(pi[0].retentionCategory).toBe('Enhanced')
  })

  it('reconciles on footprint length, not on the recorded face area', async () => {
    // The wall is rebuilt taller: same 50 m footprint, Area 150 -> 250 m².
    // Accounting must compare the footprint, or every heightened wall would
    // read as oversubscribed.
    const base = staged.baseline[HABITAT_TYPES.VERTICAL_AREAS]
    const pi = staged.postIntervention[HABITAT_TYPES.VERTICAL_AREAS]
    expect(base[0].properties.Area).toBe(150)
    expect(pi[0].properties.Area).toBe(250)

    const result = await reconcileParents(
      pool,
      HABITAT_TYPES.VERTICAL_AREAS,
      base,
      pi
    )
    expect(result.checked).toBe(true)
    expect(result.removed).toEqual([])
    expect(result.oversubscribed).toEqual([])
  })

  it('is exempt from total reconciliation — absence records demolition', async () => {
    const result = await reconcileSize(
      pool,
      HABITAT_TYPES.VERTICAL_AREAS,
      staged.baseline[HABITAT_TYPES.VERTICAL_AREAS],
      staged.postIntervention[HABITAT_TYPES.VERTICAL_AREAS]
    )
    expect(result.checked).toBe(false)
    expect(result.reason).toMatch(/absence records the loss/i)
  })

  it('reports a demolished wall as removed footprint, not as an error', async () => {
    // No PI child at all — the wall came down and nothing replaced it.
    const result = await reconcileParents(
      pool,
      HABITAT_TYPES.VERTICAL_AREAS,
      staged.baseline[HABITAT_TYPES.VERTICAL_AREAS],
      []
    )
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0]).toMatchObject({
      type: HABITAT_TYPES.VERTICAL_AREAS,
      parent_ref: 'VAH-1',
      measure: 'length'
    })
    expect(result.removed[0].removed_size).toBeCloseTo(VERTICAL_FOOTPRINT_M, 1)
    expect(result.oversubscribed).toEqual([])
  })

  it('keeps its stamped parent', async () => {
    const result = await deriveLineage(
      pool,
      staged.postIntervention[HABITAT_TYPES.VERTICAL_AREAS],
      staged.baseline[HABITAT_TYPES.VERTICAL_AREAS],
      { linear: true }
    )
    expect(result[0].source).toBe('stamped')
    expect(result[0].parents[0].ref).toBe('VAH-1')
  })
})

describe('hedgerows', () => {
  it('the surviving half keeps its stamped parent', async () => {
    // The other half of the split (HR-1b) was grubbed out — under
    // removal-by-absence it has no row at all.
    const pi = staged.postIntervention[HABITAT_TYPES.HEDGEROWS]
    expect(pi).toHaveLength(1)
    expect(pi[0].piRef).toBe('HR-1a')
    expect(pi.every((f) => f.parentRef === 'HR-1')).toBe(true)

    const result = await deriveLineage(
      pool,
      pi,
      staged.baseline[HABITAT_TYPES.HEDGEROWS],
      { linear: true }
    )
    expect(result.every((r) => r.source === 'stamped')).toBe(true)
    expect(result.every((r) => r.parents[0].ref === 'HR-1')).toBe(true)
  })

  it('resolves parentage by shared LENGTH when the stamp is absent', async () => {
    // exercises the linear geometry path, which the area fixture cannot reach
    const unstamped = staged.postIntervention[HABITAT_TYPES.HEDGEROWS].map(
      (f) => ({ ...f, parentRef: null })
    )
    const result = await deriveLineage(
      pool,
      unstamped,
      staged.baseline[HABITAT_TYPES.HEDGEROWS],
      { linear: true }
    )
    expect(result.every((r) => r.source === 'geometry')).toBe(true)
    for (const entry of result) {
      expect(entry.parents).toHaveLength(1)
      expect(entry.parents[0].ref).toBe('HR-1')
      expect(entry.parents[0].sharedSize).toBeCloseTo(HEDGE_HALF_M, 1)
    }
  })

  it('is exempt from total reconciliation — lost length is the residual', async () => {
    // The Statutory Metric's hedgerow sheet takes retained/enhanced lengths
    // per baseline row and derives the lost length as the remainder; it is
    // never entered as a row of its own.
    const result = await reconcileSize(
      pool,
      HABITAT_TYPES.HEDGEROWS,
      staged.baseline[HABITAT_TYPES.HEDGEROWS],
      staged.postIntervention[HABITAT_TYPES.HEDGEROWS]
    )
    expect(result.checked).toBe(false)
    expect(result.reason).toMatch(/residual/i)
  })

  it('reports the grubbed-out half as removed length on its parent', async () => {
    const result = await reconcileParents(
      pool,
      HABITAT_TYPES.HEDGEROWS,
      staged.baseline[HABITAT_TYPES.HEDGEROWS],
      staged.postIntervention[HABITAT_TYPES.HEDGEROWS]
    )
    expect(result.checked).toBe(true)
    expect(result.oversubscribed).toEqual([])
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0]).toMatchObject({
      type: HABITAT_TYPES.HEDGEROWS,
      parent_ref: 'HR-1',
      measure: 'length'
    })
    expect(result.removed[0].baseline_size).toBeCloseTo(HEDGE_TOTAL_M, 1)
    expect(result.removed[0].pi_size).toBeCloseTo(HEDGE_HALF_M, 1)
    expect(result.removed[0].removed_size).toBeCloseTo(HEDGE_HALF_M, 1)
  })

  it('flags children that outgrow their parent as oversubscription', async () => {
    // Duplicated rows are the realistic way this happens — paste the retained
    // half twice more and the children total 300 m against a 200 m parent.
    const pi = staged.postIntervention[HABITAT_TYPES.HEDGEROWS]
    const duplicated = [...pi, ...pi, ...pi]
    const result = await reconcileParents(
      pool,
      HABITAT_TYPES.HEDGEROWS,
      staged.baseline[HABITAT_TYPES.HEDGEROWS],
      duplicated
    )
    expect(result.removed).toEqual([])
    expect(result.oversubscribed).toHaveLength(1)
    expect(result.oversubscribed[0].parent_ref).toBe('HR-1')
    expect(result.oversubscribed[0].excess).toBeCloseTo(HEDGE_HALF_M, 1)
  })
})

describe('trees', () => {
  it('reads as points, with the felled tree simply absent', () => {
    const pi = staged.postIntervention[HABITAT_TYPES.TREES]
    expect(staged.baseline[HABITAT_TYPES.TREES]).toHaveLength(2)
    expect(pi).toHaveLength(2)
    expect(pi.every((f) => f.geometry.type === 'Point')).toBe(true)

    // T-2 was felled: under removal-by-absence it has no post-intervention
    // row at all. The planted tree is `Created` and parentless.
    expect(pi.find((f) => f.piRef === 'T-2')).toBeUndefined()
    const planted = pi.find((f) => f.piRef === 'T-NEW-1')
    expect(planted.retentionCategory).toBe('Created')
    expect(planted.parentRef).toBeNull()
  })

  it('a planted tree standing inside a habitat parcel gains no parent from it', async () => {
    // T-NEW-1 sits inside PR-1's footprint. Points have no extent, so there is
    // nothing to apportion — it must stay parentless rather than inherit the
    // polygon it happens to fall in.
    const result = await deriveLineage(
      pool,
      staged.postIntervention[HABITAT_TYPES.TREES],
      staged.baseline[HABITAT_TYPES.TREES]
    )
    const planted = result.find((r) => r.piRef === 'T-NEW-1')
    expect(planted.source).toBe('none')
    expect(planted.parents).toEqual([])
  })

  it('the retained tree keeps its stamped parent', async () => {
    const result = await deriveLineage(
      pool,
      staged.postIntervention[HABITAT_TYPES.TREES],
      staged.baseline[HABITAT_TYPES.TREES]
    )
    const stamped = result.filter((r) => r.source === 'stamped')
    expect(stamped.map((r) => r.parents[0].ref)).toEqual(['T-1'])
  })

  it('is exempt from total reconciliation — a felled tree is an absent point', async () => {
    const result = await reconcileSize(
      pool,
      HABITAT_TYPES.TREES,
      staged.baseline[HABITAT_TYPES.TREES],
      staged.postIntervention[HABITAT_TYPES.TREES]
    )
    expect(result.checked).toBe(false)
    expect(result.reason).toMatch(/absent point/i)
  })

  it('reports the felled tree as a removed count on its parent', async () => {
    const result = await reconcileParents(
      pool,
      HABITAT_TYPES.TREES,
      staged.baseline[HABITAT_TYPES.TREES],
      staged.postIntervention[HABITAT_TYPES.TREES]
    )
    expect(result.checked).toBe(true)
    expect(result.oversubscribed).toEqual([])
    expect(result.removed).toEqual([
      {
        type: HABITAT_TYPES.TREES,
        parent_ref: 'T-2',
        measure: 'count',
        baseline_size: 1,
        pi_size: 0,
        removed_size: 1
      }
    ])
  })
})

describe('the whole file', () => {
  it('carries all five habitat types on both sides', () => {
    for (const type of Object.values(HABITAT_TYPES)) {
      expect(staged.baseline[type], `baseline ${type}`).toBeDefined()
      expect(staged.postIntervention[type], `PI ${type}`).toBeDefined()
    }
  })

  it('every post-intervention feature has a retention category', () => {
    for (const features of Object.values(staged.postIntervention)) {
      for (const feature of features) {
        expect(feature.retentionCategory).toBeTruthy()
      }
    }
  })

  it('every stamped parent resolves to a real baseline feature', () => {
    for (const [type, features] of Object.entries(staged.postIntervention)) {
      const refs = new Set(staged.baseline[type].map((f) => f.ref))
      for (const feature of features.filter((f) => f.parentRef)) {
        expect(refs, `${type}/${feature.piRef}`).toContain(feature.parentRef)
      }
    }
  })
})
