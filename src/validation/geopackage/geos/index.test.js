import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { validateGeoPackageLayersGeos } from './index.js'
import {
  EDGE,
  HALF,
  SELF_INTERSECTING,
  X0,
  Y0,
  layers,
  line,
  point,
  polygon,
  square,
  validLayers
} from './test-fixtures.js'

/** Error codes raised for `input`, in the order the engine emits them. */
async function codesFor(input) {
  const { errors } = await validateGeoPackageLayersGeos(input)
  return errors.map((error) => error.code)
}

/** The single error object for `code`, or undefined. */
async function errorFor(input, code) {
  const { errors } = await validateGeoPackageLayersGeos(input)
  return errors.find((error) => error.code === code)
}

describe('validateGeoPackageLayersGeos — happy path', () => {
  it('accepts a redline exactly filled by one parcel', async () => {
    const result = await validateGeoPackageLayersGeos(validLayers())
    expect(result).toMatchObject({ valid: true, errors: [] })
  })

  it('accepts a redline tiled by parcels sharing edges', async () => {
    const result = await validateGeoPackageLayersGeos(
      layers({
        redline: [polygon(square(X0, Y0, EDGE))],
        areas: [
          polygon(square(X0, Y0, HALF), { fid: 1 }),
          polygon(square(X0 + HALF, Y0, HALF), { fid: 2 }),
          polygon(square(X0, Y0 + HALF, HALF), { fid: 3 }),
          polygon(square(X0 + HALF, Y0 + HALF, HALF), { fid: 4 })
        ]
      })
    )
    expect(result.errors).toEqual([])
  })

  it('reports the GEOS version it ran on, for divergence triage', async () => {
    const { geosVersion } = await validateGeoPackageLayersGeos(validLayers())
    expect(geosVersion).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('validateGeoPackageLayersGeos — redline-level errors', () => {
  it('detects an empty redline layer as NO_REDLINE', async () => {
    expect(await codesFor(layers({ areas: [polygon(square())] }))).toContain(
      ERROR_CODES.NO_REDLINE
    )
  })

  it('reports nothing about containment when there is no redline to contain anything', async () => {
    // The SQL guards every containment CTE on `redl.geom IS NOT NULL`, so a
    // file with no redline is not also told its parcels escape it.
    const codes = await codesFor(
      layers({
        areas: [polygon(square())],
        trees: [point([0, 0])],
        hedgerows: [
          line([
            [0, 0],
            [1, 1]
          ])
        ]
      })
    )
    expect(codes).toEqual([ERROR_CODES.NO_REDLINE])
  })

  it('detects a self-intersecting redline, with the reason and location', async () => {
    const error = await errorFor(
      layers({
        redline: [polygon(SELF_INTERSECTING)],
        areas: [polygon(square())]
      }),
      ERROR_CODES.REDLINE_INVALID_GEOMETRY
    )
    expect(error.message).toContain('Self-intersection')
    expect(error.message).toMatch(/POINT\(\d+ \d+\)/)
  })

  it('detects a redline outside England', async () => {
    // Mid-Atlantic, in British National Grid units.
    expect(
      await codesFor(
        layers({
          redline: [polygon(square(0, 0, EDGE))],
          areas: [polygon(square(0, 0, EDGE))]
        })
      )
    ).toContain(ERROR_CODES.REDLINE_OUTSIDE_ENGLAND)
  })

  it('detects a redline over the 100 sq km cap, and names its area', async () => {
    const tenKm = 10_000 + 1
    const error = await errorFor(
      layers({ redline: [polygon(square(X0, Y0, tenKm))] }),
      ERROR_CODES.REDLINE_AREA_TOO_LARGE
    )
    expect(error.message).toMatch(/exceeds the 100 sq km limit/)
  })
})

describe('validateGeoPackageLayersGeos — habitat parcel errors', () => {
  it('detects an empty habitat layer as NO_HABITAT_AREAS', async () => {
    expect(await codesFor(layers({ redline: [polygon(square())] }))).toContain(
      ERROR_CODES.NO_HABITAT_AREAS
    )
  })

  it('detects invalid area habitat geometry, listing each offender', async () => {
    const error = await errorFor(
      layers({
        redline: [polygon(square())],
        areas: [polygon(SELF_INTERSECTING, { fid: 1, 'Parcel Ref': 'H001' })]
      }),
      ERROR_CODES.AREA_PARCELS_INVALID_GEOMETRY
    )
    expect(error.details.count).toBe(1)
    expect(error.details.sample[0]).toMatchObject({
      idx: 0,
      fid: '1',
      feature_ref: 'H001'
    })
    expect(error.message).toContain('Feature Ref H001')
  })

  it('detects overlapping parcels as a pair', async () => {
    const error = await errorFor(
      layers({
        redline: [polygon(square())],
        areas: [
          polygon(square(), { fid: 1, 'Parcel Ref': 'A' }),
          polygon(square(X0 + HALF, Y0 + HALF), { fid: 2, 'Parcel Ref': 'B' })
        ]
      }),
      ERROR_CODES.PARCEL_OVERLAPS
    )
    expect(error.details.sample).toEqual([
      {
        idx_a: 0,
        fid_a: '1',
        feature_ref_a: 'A',
        idx_b: 1,
        fid_b: '2',
        feature_ref_b: 'B'
      }
    ])
  })

  it('does not flag parcels that merely share an edge', async () => {
    expect(
      await codesFor(
        layers({
          redline: [polygon(square(X0, Y0, EDGE))],
          areas: [
            polygon(square(X0, Y0, HALF)),
            polygon(square(X0 + HALF, Y0, HALF)),
            polygon(square(X0, Y0 + HALF, HALF)),
            polygon(square(X0 + HALF, Y0 + HALF, HALF))
          ]
        })
      )
    ).not.toContain(ERROR_CODES.PARCEL_OVERLAPS)
  })

  it('compares overlaps on the repaired geometry, so a broken parcel is still checked', async () => {
    // The bow-tie repairs into two triangles meeting at (X0+50, Y0+50); the
    // neighbour covers the upper one. GEOS cannot evaluate this pair at all
    // against the raw ring.
    const error = await errorFor(
      layers({
        redline: [polygon(square())],
        areas: [
          polygon(SELF_INTERSECTING, { fid: 1 }),
          polygon(square(X0 + 10, Y0 + 60, 30), { fid: 2 })
        ]
      }),
      ERROR_CODES.PARCEL_OVERLAPS
    )
    expect(error.details.count).toBe(1)
  })

  it('detects a parcel under the 1 sq m minimum, and names its area', async () => {
    const error = await errorFor(
      layers({
        redline: [polygon(square())],
        areas: [
          polygon(square(), { fid: 1 }),
          polygon(square(X0 + 10, Y0 + 10, 0.9), {
            fid: 2,
            'Parcel Ref': 'H002'
          })
        ]
      }),
      ERROR_CODES.AREA_PARCELS_TOO_SMALL
    )
    expect(error.details.sample[0].area_sqm).toBeCloseTo(0.81, 6)
    expect(error.message).toContain('~0.81 sq m')
  })

  it('accepts a long thin parcel whose area clears the minimum', async () => {
    const thin = [
      [X0, Y0],
      [X0 + 100, Y0],
      [X0 + 100, Y0 + 1],
      [X0, Y0 + 1],
      [X0, Y0]
    ]
    expect(
      await codesFor(
        layers({ redline: [polygon(thin)], areas: [polygon(thin)] })
      )
    ).not.toContain(ERROR_CODES.AREA_PARCELS_TOO_SMALL)
  })

  it('detects a parcel escaping the redline, with the escape area and location', async () => {
    const error = await errorFor(
      layers({
        redline: [polygon(square(X0, Y0, EDGE))],
        areas: [
          polygon(square(X0, Y0, EDGE * 2), { fid: 1, 'Parcel Ref': 'H001' })
        ]
      }),
      ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE
    )
    expect(error.details.sample[0].escape_area_sqm).toBeCloseTo(30_000, 3)
    expect(error.details.sample[0].escape_location_wkt).toMatch(/^POLYGON\(\(/)
  })

  it('detects the same escaping land as slivers, cut by piece rather than by parcel', async () => {
    const error = await errorFor(
      layers({
        redline: [polygon(square(X0, Y0, EDGE))],
        areas: [polygon(square(X0, Y0, EDGE * 2))]
      }),
      ERROR_CODES.SLIVERS_OUTSIDE_REDLINE
    )
    expect(error.details.count).toBe(1)
    expect(error.details.sample[0].area_sqm).toBeCloseTo(30_000, 3)
  })

  it('does not flag parcels that share the redline edge exactly', async () => {
    expect(await codesFor(validLayers())).not.toContain(
      ERROR_CODES.SLIVERS_OUTSIDE_REDLINE
    )
  })

  it('detects an area sum mismatch, naming both totals', async () => {
    const error = await errorFor(
      layers({
        redline: [polygon(square(X0, Y0, EDGE))],
        areas: [polygon(square(X0, Y0, HALF))]
      }),
      ERROR_CODES.AREA_SUM_MISMATCH
    )
    expect(error.message).toContain('2500.00 sq m')
    expect(error.message).toContain('10000.00 sq m')
  })
})

describe('validateGeoPackageLayersGeos — non-area layers outside the redline', () => {
  const inside = validLayers()

  it('detects a hedgerow outside the redline', async () => {
    expect(
      await codesFor({
        ...inside,
        hedgerows: [
          line(
            [
              [X0 + 200, Y0],
              [X0 + 300, Y0]
            ],
            { fid: 1 }
          )
        ]
      })
    ).toContain(ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE)
  })

  it('detects a watercourse outside the redline', async () => {
    expect(
      await codesFor({
        ...inside,
        watercourses: [
          line(
            [
              [X0 + 200, Y0],
              [X0 + 300, Y0]
            ],
            { fid: 1 }
          )
        ]
      })
    ).toContain(ERROR_CODES.WATERCOURSES_OUTSIDE_REDLINE)
  })

  it('detects an IGGI outside the redline', async () => {
    expect(
      await codesFor({
        ...inside,
        iggis: [polygon(square(X0 + 200, Y0 + 200, EDGE), { fid: 1 })]
      })
    ).toContain(ERROR_CODES.IGGIS_OUTSIDE_REDLINE)
  })

  it('detects a tree outside the redline', async () => {
    expect(
      await codesFor({
        ...inside,
        trees: [point([X0 + 200, Y0 + 200], { fid: 1, 'Tree Ref': 'T002' })]
      })
    ).toContain(ERROR_CODES.TREES_OUTSIDE_REDLINE)
  })

  it('names the offending tree by its Tree Ref', async () => {
    const error = await errorFor(
      {
        ...inside,
        trees: [point([X0 + 200, Y0 + 200], { 'Tree Ref': 'T002' })]
      },
      ERROR_CODES.TREES_OUTSIDE_REDLINE
    )
    expect(error.message).toContain('Feature Ref T002')
  })
})

describe('validateGeoPackageLayersGeos — boundary tolerance', () => {
  const inside = validLayers()

  it('passes a hedgerow whose endpoint lies exactly on the redline edge', async () => {
    expect(
      await codesFor({
        ...inside,
        hedgerows: [
          line([
            [X0 + 10, Y0 + 10],
            [X0 + EDGE, Y0 + 10]
          ])
        ]
      })
    ).toEqual([])
  })

  it('passes a hedgerow escaping by 5 cm, under the 10 cm tolerance', async () => {
    expect(
      await codesFor({
        ...inside,
        hedgerows: [
          line([
            [X0 + 10, Y0 + 10],
            [X0 + EDGE + 0.05, Y0 + 10]
          ])
        ]
      })
    ).toEqual([])
  })

  it('flags a hedgerow escaping by 50 cm', async () => {
    expect(
      await codesFor({
        ...inside,
        hedgerows: [
          line([
            [X0 + 10, Y0 + 10],
            [X0 + EDGE + 0.5, Y0 + 10]
          ])
        ]
      })
    ).toContain(ERROR_CODES.HEDGEROWS_OUTSIDE_REDLINE)
  })

  it('passes a tree placed exactly on the redline edge', async () => {
    expect(
      await codesFor({ ...inside, trees: [point([X0 + EDGE, Y0 + HALF])] })
    ).toEqual([])
  })

  it('flags a tree 50 cm outside the redline edge', async () => {
    expect(
      await codesFor({
        ...inside,
        trees: [point([X0 + EDGE + 0.5, Y0 + HALF])]
      })
    ).toContain(ERROR_CODES.TREES_OUTSIDE_REDLINE)
  })

  it('passes an IGGI sharing an edge with the redline', async () => {
    expect(
      await codesFor({
        ...inside,
        iggis: [polygon(square(X0, Y0, HALF))]
      })
    ).toEqual([])
  })

  it('accepts a small gap left between the parcels and the redline', async () => {
    // A 2 mm gap along two edges of a 100 m square leaves 0.4 sq m uncovered —
    // under the 0.5 sq m sliver tolerance, and under the 0.5 sq m area-sum one.
    const gap = 0.002
    expect(
      await codesFor(
        layers({
          redline: [polygon(square(X0, Y0, EDGE))],
          areas: [polygon(square(X0, Y0 + gap, EDGE - gap))]
        })
      )
    ).toEqual([])
  })
})

describe('validateGeoPackageLayersGeos — coordinate systems', () => {
  it('accepts an EPSG:4326 file without spuriously flagging it', async () => {
    // A small square near Maidenhead, in WGS84 degrees.
    const ring = [
      [-0.72, 51.52],
      [-0.7185, 51.52],
      [-0.7185, 51.5209],
      [-0.72, 51.5209],
      [-0.72, 51.52]
    ]
    const result = await validateGeoPackageLayersGeos(
      layers({
        redline: [polygon(ring, {}, 4326)],
        areas: [polygon(ring, { fid: 1 }, 4326)]
      })
    )
    expect(result).toMatchObject({ valid: true, errors: [] })
  })
})

describe('validateGeoPackageLayersGeos — error ordering', () => {
  it('emits codes in the shared engine order, not in check order', async () => {
    const codes = await codesFor(
      layers({
        redline: [polygon(square(0, 0, EDGE))],
        areas: [
          polygon(square(0, 0, EDGE), { fid: 1 }),
          polygon(square(HALF, HALF, EDGE), { fid: 2 })
        ]
      })
    )
    expect(codes).toEqual([
      ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
      ERROR_CODES.PARCEL_OVERLAPS,
      ERROR_CODES.SLIVERS_OUTSIDE_REDLINE,
      ERROR_CODES.AREA_PARCELS_OUTSIDE_REDLINE,
      ERROR_CODES.AREA_SUM_MISMATCH
    ])
  })
})

describe('validateGeoPackageLayersGeos — habitat sizes', () => {
  it('returns nothing extra unless asked', async () => {
    const result = await validateGeoPackageLayersGeos(validLayers())
    expect(result.sizes).toBeUndefined()
  })

  it('measures areas and lengths off the same repaired geometry as the checks', async () => {
    const { sizes } = await validateGeoPackageLayersGeos(
      layers({
        redline: [polygon(square())],
        areas: [polygon(square(), { fid: 1 })],
        hedgerows: [
          line(
            [
              [X0, Y0],
              [X0 + 30, Y0]
            ],
            { fid: 2 }
          )
        ],
        watercourses: [
          line(
            [
              [X0, Y0],
              [X0, Y0 + 40]
            ],
            { fid: 3 }
          )
        ]
      }),
      { includeSizes: true }
    )
    expect(sizes.areas).toEqual([{ idx: 0, value: 10_000 }])
    expect(sizes.hedgerows).toEqual([{ idx: 0, value: 30 }])
    expect(sizes.watercourses).toEqual([{ idx: 0, value: 40 }])
  })

  it('keys sizes by array position, so a feature without geometry does not shift them', async () => {
    const { sizes } = await validateGeoPackageLayersGeos(
      layers({
        redline: [polygon(square())],
        areas: [
          { type: 'Feature', properties: {}, nativeGeometry: null },
          polygon(square(), { fid: 2 })
        ]
      }),
      { includeSizes: true }
    )
    expect(sizes.areas).toEqual([{ idx: 1, value: 10_000 }])
  })
})
