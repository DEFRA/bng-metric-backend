// The drift check on its own, with plain feature objects shaped like
// readStagedGeoPackage output. No database and no GeoPackage file.

import { describe, expect, it } from 'vitest'

import { baselineDrift } from './baseline-drift.js'

const HEDGEROWS = 'hedgerows'

/** Milliseconds. Generous: rejecting the crafted text takes well under 1 ms. */
const CRAFTED_TEXT_TIME_LIMIT_MS = 500
/** Vertices in the large-parent test: more than a spread argument list can hold. */
const LARGE_VERTEX_COUNT = 130_000
const HR1_UUID = '4dc7c07a-0000-4000-8000-000000000001'
const HR2_UUID = '4dc7c07a-0000-4000-8000-000000000002'

/** Baseline hedge HR-1, 200 m along y=300, as decoded from WKB. */
const HR1_GEOMETRY = {
  type: 'LineString',
  coordinates: [
    [0, 300],
    [200, 300]
  ]
}
/** HR-1 as the template's Copy action records it in parent_geom. */
const HR1_WKT = 'LineString (0 300, 200 300)'
/** HR-1 after a surveyor dragged its eastern end 1 m north. */
const HR1_MOVED_GEOMETRY = {
  type: 'LineString',
  coordinates: [
    [0, 300],
    [200, 301]
  ]
}

function baselineRow({
  ref = 'HR-1',
  uuid = HR1_UUID,
  geometry = HR1_GEOMETRY
} = {}) {
  return { ref, featureUuid: uuid, geometry }
}

function piRow({
  piRef = 'HR-1a',
  parentRef = 'HR-1',
  parentUuid = HR1_UUID,
  parentGeom = HR1_WKT
} = {}) {
  return { piRef, parentRef, parentUuid, parentGeom }
}

describe('baselineDrift', () => {
  it('reports nothing when parent_geom matches the baseline', () => {
    expect(baselineDrift(HEDGEROWS, [piRow()], [baselineRow()])).toEqual([])
  })

  it('reports a baseline feature edited after the row was linked', () => {
    const baseline = [baselineRow({ geometry: HR1_MOVED_GEOMETRY })]

    expect(baselineDrift(HEDGEROWS, [piRow()], baseline)).toEqual([
      { type: HEDGEROWS, parent_ref: 'HR-1', pi_count: 1 }
    ])
  })

  it('accepts a full-precision parent_geom of an unchanged baseline', () => {
    const geometry = {
      type: 'LineString',
      coordinates: [
        [467485.4859323712, 227720.9382970471],
        [467374.3032303991, 227488.00333352556]
      ]
    }
    const parentGeom =
      'LineString (467485.4859323712 227720.9382970471, 467374.3032303991 227488.00333352556)'

    expect(
      baselineDrift(
        HEDGEROWS,
        [piRow({ parentGeom })],
        [baselineRow({ geometry })]
      )
    ).toEqual([])
  })

  it('accepts the uppercase fixed-decimal WKT the Python writers produce', () => {
    const parentGeom = 'LINESTRING (0.000 300.000, 200.000 300.000)'

    expect(
      baselineDrift(HEDGEROWS, [piRow({ parentGeom })], [baselineRow()])
    ).toEqual([])
  })

  it('ignores a vertex topological editing inserted on an edge', () => {
    // On the edge at full precision, 1.12 mm off it once rounded. The
    // parent_geom was recorded before the insert.
    const parentGeom =
      'LineString (463883.585 266699.590, 463851.562 266727.893, 463818.602 266674.586, 463865.228 266639.856)'
    const geometry = {
      type: 'LineString',
      coordinates: [
        [463883.58488036745, 266699.5897312017],
        [463851.5624036727, 266727.8925372318],
        [463836.71059193864, 266703.8724173193],
        [463818.60232436936, 266674.58556893945],
        [463865.22750951315, 266639.85572280985]
      ]
    }

    expect(
      baselineDrift(
        HEDGEROWS,
        [piRow({ parentGeom })],
        [baselineRow({ geometry })]
      )
    ).toEqual([])
  })

  it('skips a stamped row with no parent_geom, silently', () => {
    const baseline = [baselineRow({ geometry: HR1_MOVED_GEOMETRY })]

    for (const parentGeom of [null, undefined, '', '   ']) {
      const row = { ...piRow(), parentGeom }
      expect(baselineDrift(HEDGEROWS, [row], baseline)).toEqual([])
    }
  })

  it('counts an unreadable or EMPTY parent_geom as drift', () => {
    for (const parentGeom of [
      'garbage',
      'LineString EMPTY',
      'CircularString (0 300, 100 350, 200 300)'
    ]) {
      expect(
        baselineDrift(HEDGEROWS, [piRow({ parentGeom })], [baselineRow()])
      ).toEqual([{ type: HEDGEROWS, parent_ref: 'HR-1', pi_count: 1 }])
    }
  })

  it('counts a parent_geom over the length cap as drift, unread', () => {
    // 8.5 MB of text: over the cap, so it is rejected before any parsing.
    const parentGeom = `LineString (${'1 1, '.repeat(1_700_000)}2 2)`

    const started = performance.now()
    const drift = baselineDrift(
      HEDGEROWS,
      [piRow({ parentGeom })],
      [baselineRow()]
    )
    const elapsed = performance.now() - started

    expect(drift).toEqual([
      { type: HEDGEROWS, parent_ref: 'HR-1', pi_count: 1 }
    ])
    expect(elapsed).toBeLessThan(CRAFTED_TEXT_TIME_LIMIT_MS)
  })

  it('matches a record with more raw vertices than the baseline row, all collinear', () => {
    // Corners that topological editing added before the record was made, and
    // that were later removed from the baseline, change nothing.
    const along = Array.from({ length: 50 }, (_, i) => `${i * 4} 300`)
    const parentGeom = `LineString (${[...along, '200 300'].join(', ')})`

    expect(
      baselineDrift(HEDGEROWS, [piRow({ parentGeom })], [baselineRow()])
    ).toEqual([])
  })

  it('reads a genuine parent_geom of a very large parent', () => {
    const geometry = {
      type: 'LineString',
      coordinates: Array.from({ length: LARGE_VERTEX_COUNT }, (_, i) => [
        i,
        300 + (i % 2)
      ])
    }
    const parentGeom = `LineString (${geometry.coordinates
      .map(([x, y]) => `${x} ${y}`)
      .join(', ')})`
    const children = [piRow({ piRef: 'HR-1a' }), piRow({ piRef: 'HR-1b' })].map(
      (row) => ({ ...row, parentGeom })
    )

    expect(
      baselineDrift(HEDGEROWS, children, [baselineRow({ geometry })])
    ).toEqual([])
  })

  it('checks a row stamped by Parent Ref alone', () => {
    const refOnly = piRow({ parentUuid: null })

    expect(baselineDrift(HEDGEROWS, [refOnly], [baselineRow()])).toEqual([])
    expect(
      baselineDrift(
        HEDGEROWS,
        [refOnly],
        [baselineRow({ geometry: HR1_MOVED_GEOMETRY })]
      )
    ).toEqual([{ type: HEDGEROWS, parent_ref: 'HR-1', pi_count: 1 }])
  })

  it('resolves the parent by uuid before Parent Ref, as deriveLineage does', () => {
    // The visible ref names HR-2, but the uuid names HR-1, and the uuid wins.
    const baseline = [
      baselineRow(),
      baselineRow({
        ref: 'HR-2',
        uuid: HR2_UUID,
        geometry: HR1_MOVED_GEOMETRY
      })
    ]

    expect(
      baselineDrift(HEDGEROWS, [piRow({ parentRef: 'HR-2' })], baseline)
    ).toEqual([])
  })

  it('reports each drifted parent once, counting its children', () => {
    const baseline = [baselineRow({ geometry: HR1_MOVED_GEOMETRY })]
    const children = [piRow({ piRef: 'HR-1a' }), piRow({ piRef: 'HR-1b' })]

    expect(baselineDrift(HEDGEROWS, children, baseline)).toEqual([
      { type: HEDGEROWS, parent_ref: 'HR-1', pi_count: 2 }
    ])
  })

  it('accepts a match with any row of a parent split into several rows', () => {
    const westHalf = {
      type: 'LineString',
      coordinates: [
        [0, 300],
        [100, 300]
      ]
    }
    const baseline = [
      baselineRow({ geometry: westHalf }),
      baselineRow({ geometry: HR1_GEOMETRY })
    ]

    expect(baselineDrift(HEDGEROWS, [piRow()], baseline)).toEqual([])
  })

  it('names the parent by uuid when the baseline row has no ref', () => {
    const baseline = [baselineRow({ ref: null, geometry: HR1_MOVED_GEOMETRY })]

    expect(baselineDrift(HEDGEROWS, [piRow()], baseline)).toEqual([
      { type: HEDGEROWS, parent_ref: HR1_UUID, pi_count: 1 }
    ])
  })

  it('leaves unstamped rows and stamps that resolve nowhere to other checks', () => {
    const baseline = [baselineRow({ geometry: HR1_MOVED_GEOMETRY })]
    const rows = [
      piRow({ parentRef: null, parentUuid: null }),
      piRow({ parentRef: 'GONE', parentUuid: 'no-such-uuid' })
    ]

    expect(baselineDrift(HEDGEROWS, rows, baseline)).toEqual([])
  })
})
