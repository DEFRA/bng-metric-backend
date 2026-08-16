// Containment: a post-intervention feature stamped with a parent must lie
// inside that parent.
//
// Measured as the size of ST_Difference, never as a Boolean predicate — a
// parcel cut from its parent shares that parent's edges exactly, and a vertex
// one ULP outside a shared edge makes ST_Within false while the geometric
// distance is zero. The "coincident with its parent" tests below are what stop
// that regressing.
//
// The synthetic geometries are in the same coordinate space as the fixture
// (a 100 m grid at the origin), so an escape of "100" reads as 100 sq m or
// 100 m without any arithmetic.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

import { checkContainment } from '../src/validation/geopackage/lineage/containment.js'
import { deriveLineage } from '../src/validation/geopackage/lineage/derive-lineage.js'
import { readStagedGeoPackage } from '../src/validation/geopackage/lineage/read-staged-geopackage.js'
import { isLinearMeasure } from '../src/validation/geopackage/lineage/reconcile.js'
import { HABITAT_TYPES } from '../src/validation/geopackage/lineage/staged-layer-names.js'
import { getDbConfig } from './helpers/db.js'

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'staged-baseline-and-pi.gpkg'
)

const OVERHANG_SQ_M = 100
const OVERHANG_M = 100
const PRECISION_DP = 1

const pool = new pg.Pool(getDbConfig())
let staged

function polygon(coordinates) {
  return { type: 'Polygon', coordinates: [coordinates] }
}

function line(coordinates) {
  return { type: 'LineString', coordinates }
}

/**
 * Run the real pipeline — deriveLineage then checkContainment — so the tests
 * exercise the same lineage the routes would produce rather than a hand-built
 * stand-in.
 */
async function containmentFor(type, postIntervention, baseline) {
  const lineage = await deriveLineage(pool, postIntervention, baseline, {
    linear: isLinearMeasure(type)
  })
  return checkContainment(pool, type, { postIntervention, baseline, lineage })
}

beforeAll(() => {
  staged = readStagedGeoPackage(FIXTURE)
})

afterAll(async () => {
  await pool.end().catch(() => {})
})

describe('containment against the real fixture', () => {
  it.each([
    HABITAT_TYPES.AREAS,
    HABITAT_TYPES.VERTICAL_AREAS,
    HABITAT_TYPES.HEDGEROWS
  ])('%s: every trimmed feature stays inside its parent', async (type) => {
    // These parcels were cut out of their parents, so they share edges with
    // them along their whole length. A predicate-based check fails here.
    const offenders = await containmentFor(
      type,
      staged.postIntervention[type],
      staged.baseline[type]
    )

    expect(offenders).toEqual([])
  })

  it('does not test the pond, whose parent came from geometry', async () => {
    // PI-POND straddles both baseline parcels and has no stamped parent. Its
    // parentage is derived BY overlap, so testing it for overlap proves
    // nothing — and against either parent alone it would "escape" by 1250 sq m.
    const offenders = await containmentFor(
      HABITAT_TYPES.AREAS,
      staged.postIntervention[HABITAT_TYPES.AREAS],
      staged.baseline[HABITAT_TYPES.AREAS]
    )

    expect(offenders.map((o) => o.pi_ref)).not.toContain('PI-POND')
  })
})

describe('containment catches a feature that strays', () => {
  it('reports the escaping area, not just that it escaped', async () => {
    const baseline = [
      { ref: 'PR-1', geometry: staged.baseline.areas[0].geometry }
    ]
    const postIntervention = [
      {
        piRef: 'PR-1a',
        parentRef: 'PR-1',
        // 10 m of the parcel's 20 m width hangs off the west edge of PR-1.
        geometry: polygon([
          [-10, 0],
          [10, 0],
          [10, 10],
          [-10, 10],
          [-10, 0]
        ])
      }
    ]

    const [offender] = await containmentFor(
      HABITAT_TYPES.AREAS,
      postIntervention,
      baseline
    )

    expect(offender).toMatchObject({
      type: HABITAT_TYPES.AREAS,
      pi_ref: 'PR-1a',
      parent_ref: 'PR-1',
      measure: 'area'
    })
    expect(offender.escape_size).toBeCloseTo(OVERHANG_SQ_M, PRECISION_DP)
  })

  it('accepts a feature exactly coincident with its parent', async () => {
    const parent = staged.baseline.areas[0].geometry
    const offenders = await containmentFor(
      HABITAT_TYPES.AREAS,
      [{ piRef: 'PR-1', parentRef: 'PR-1', geometry: parent }],
      [{ ref: 'PR-1', geometry: parent }]
    )

    expect(offenders).toEqual([])
  })

  it('measures a hedgerow in metres off its parent line', async () => {
    const baseline = [
      { ref: 'HR-1', geometry: staged.baseline.hedgerows[0].geometry }
    ]
    const postIntervention = [
      {
        piRef: 'HR-1a',
        parentRef: 'HR-1',
        // Realigned 10 m north — legitimate for a watercourse, not a hedge.
        geometry: line([
          [0, 310],
          [100, 310]
        ])
      }
    ]

    const [offender] = await containmentFor(
      HABITAT_TYPES.HEDGEROWS,
      postIntervention,
      baseline
    )

    expect(offender.measure).toBe('length')
    expect(offender.escape_size).toBeCloseTo(OVERHANG_M, PRECISION_DP)
  })

  it('unions a parent drawn as more than one baseline row', async () => {
    // Differencing against only the first row would report the rest of the
    // parent as an escape.
    const baseline = [
      {
        ref: 'SPLIT',
        geometry: polygon([
          [0, 0],
          [50, 0],
          [50, 100],
          [0, 100],
          [0, 0]
        ])
      },
      {
        ref: 'SPLIT',
        geometry: polygon([
          [50, 0],
          [100, 0],
          [100, 100],
          [50, 100],
          [50, 0]
        ])
      }
    ]
    const postIntervention = [
      {
        piRef: 'SPLIT-a',
        parentRef: 'SPLIT',
        geometry: polygon([
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
          [0, 0]
        ])
      }
    ]

    const offenders = await containmentFor(
      HABITAT_TYPES.AREAS,
      postIntervention,
      baseline
    )

    expect(offenders).toEqual([])
  })
})

describe('the exemptions are load-bearing', () => {
  it('lets a watercourse move off its old line', async () => {
    // Re-meandering a straightened channel is a headline BNG intervention.
    // Enforcing containment here would reject every instance of it.
    const [base] = staged.baseline[HABITAT_TYPES.WATERCOURSES]
    const [pi] = staged.postIntervention[HABITAT_TYPES.WATERCOURSES]

    const offenders = await containmentFor(
      HABITAT_TYPES.WATERCOURSES,
      [pi],
      [base]
    )

    expect(offenders).toEqual([])
  })

  it('leaves trees alone — a point has no extent to contain', async () => {
    const offenders = await containmentFor(
      HABITAT_TYPES.TREES,
      staged.postIntervention[HABITAT_TYPES.TREES],
      staged.baseline[HABITAT_TYPES.TREES]
    )

    expect(offenders).toEqual([])
  })
})
