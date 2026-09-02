import { describe, expect, it } from 'vitest'

import {
  attachGeometrySizes,
  calculateHabitatSizes,
  GEOMETRY_SIZE_FIELD,
  HABITAT_SIZE_LAYERS
} from './calculate-habitat-sizes.js'

const feature = (featureId, extra = {}) => ({
  featureId,
  nativeGeometry: { type: 'Point', coordinates: [0, 0] },
  nativeSrid: 27_700,
  properties: {},
  ...extra
})

/** Layers with every sized layer present, so a test names only what it cares about. */
const layers = (overrides = {}) => ({
  areas: [],
  hedgerows: [],
  watercourses: [],
  ...overrides
})

describe('HABITAT_SIZE_LAYERS', () => {
  it('covers the three layers the document records a size for', () => {
    expect(HABITAT_SIZE_LAYERS).toEqual(['areas', 'hedgerows', 'watercourses'])
  })
})

describe('attachGeometrySizes', () => {
  it('stamps engine measurements onto features by their layer position', () => {
    const stamped = attachGeometrySizes(
      layers({
        areas: [feature('a'), feature('b')],
        hedgerows: [feature('h')]
      }),
      {
        areas: [
          { idx: 0, value: 10 },
          { idx: 1, value: 20 }
        ],
        hedgerows: [{ idx: 0, value: 30 }],
        watercourses: []
      }
    )
    expect(stamped.areas.map((f) => f[GEOMETRY_SIZE_FIELD])).toEqual([10, 20])
    expect(stamped.hedgerows[0][GEOMETRY_SIZE_FIELD]).toBe(30)
  })

  it('leaves the caller’s layers untouched', () => {
    const input = layers({ areas: [feature('a')] })
    attachGeometrySizes(input, { areas: [{ idx: 0, value: 10 }] })
    expect(input.areas[0][GEOMETRY_SIZE_FIELD]).toBeUndefined()
  })

  it('skips positions the engine did not measure, so gaps do not shift sizes', () => {
    const stamped = attachGeometrySizes(
      layers({
        areas: [
          { featureId: 'skipped', nativeGeometry: null },
          feature('measured')
        ]
      }),
      { areas: [{ idx: 1, value: 99 }] }
    )
    expect(stamped.areas[0][GEOMETRY_SIZE_FIELD]).toBeUndefined()
    expect(stamped.areas[1][GEOMETRY_SIZE_FIELD]).toBe(99)
  })

  it('is a no-op when the engine measured nothing', () => {
    const input = layers({ areas: [feature('a')] })
    expect(attachGeometrySizes(input, undefined)).toBe(input)
  })

  it('carries layers it does not size through unchanged', () => {
    const trees = [feature('t')]
    const stamped = attachGeometrySizes(layers({ trees }), { areas: [] })
    expect(stamped.trees).toBe(trees)
  })
})

describe('calculateHabitatSizes', () => {
  it('shapes the measurements into the result the document extract reads', () => {
    const sizes = calculateHabitatSizes(
      attachGeometrySizes(
        layers({
          areas: [feature('a1'), feature('a2')],
          hedgerows: [feature('h1')],
          watercourses: [feature('w1')]
        }),
        {
          areas: [
            { idx: 0, value: 100 },
            { idx: 1, value: 250 }
          ],
          hedgerows: [{ idx: 0, value: 40 }],
          watercourses: [{ idx: 0, value: 60 }]
        }
      )
    )

    expect(sizes.areaHabitats).toEqual({
      individualSquareMetres: [
        { featureId: 'a1', sizeSquareMetres: 100 },
        { featureId: 'a2', sizeSquareMetres: 250 }
      ],
      totalSquareMetres: 350
    })
    expect(sizes.hedgerows).toEqual({
      individualMetres: [{ featureId: 'h1', sizeMetres: 40 }],
      totalMetres: 40
    })
    expect(sizes.watercourses).toEqual({
      individualMetres: [{ featureId: 'w1', sizeMetres: 60 }],
      totalMetres: 60
    })
  })

  it('returns empty totals for a file with nothing to size', () => {
    const sizes = calculateHabitatSizes(layers())
    expect(sizes.areaHabitats.totalSquareMetres).toBe(0)
    expect(sizes.hedgerows.individualMetres).toEqual([])
  })

  it('ignores features with no geometry, which were never measured', () => {
    const sizes = calculateHabitatSizes(
      layers({ areas: [{ featureId: 'no-geometry', nativeGeometry: null }] })
    )
    expect(sizes.areaHabitats.individualSquareMetres).toEqual([])
  })

  // Fatal rather than partial on purpose: half a document's habitats silently
  // recorded without a size would surface much later, as wrong units.
  it('throws when a feature that should have been measured was not', () => {
    expect(() =>
      calculateHabitatSizes(layers({ areas: [feature('a1')] }))
    ).toThrow(/did not measure areas feature a1/)
  })

  it('names the layer as well as the feature when it throws', () => {
    expect(() =>
      calculateHabitatSizes(layers({ watercourses: [feature('w9')] }))
    ).toThrow(/watercourses feature w9/)
  })
})
