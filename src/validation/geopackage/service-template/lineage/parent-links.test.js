import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../../errors.js'
import { MAX_PARENT_GEOM_CHARS, checkParentLinks } from './parent-links.js'

const AREA_BASELINE = 'Area Habitats Baseline'
const AREA_PI = 'Area Habitats Post-Intervention'
const HEDGE_BASELINE = 'Hedgerows Baseline'
const HEDGE_PI = 'Hedgerows Post-Intervention'
const PARENT_UUID = 'de9d1450-90f7-584a-9710-edf7ec189de4'
const HEDGE_UUID = '058245bc-2cce-58fa-9b8f-de304545f380'
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000'

// A parcel at full precision, as the baseline is decoded from WKB.
const PARCEL = [
  [529508.0481, 179859.0112],
  [529517.5373, 179845.5904],
  [529693.7651, 179940.7139],
  [529508.0481, 179859.0112]
]
// The same parcel as the template records it: WKT, at millimetres.
const PARCEL_WKT =
  'Polygon ((529508.048 179859.011, 529517.537 179845.590, 529693.765 179940.714, 529508.048 179859.011))'
const HEDGE = [
  [529538.385, 180229.071],
  [529773.868, 180060.227]
]
const HEDGE_WKT = 'LINESTRING (529538.385 180229.071, 529773.868 180060.227)'

function baselineParcel(overrides = {}) {
  return {
    properties: {
      fid: 1,
      'Parcel Ref': 'H001',
      'Baseline Habitat Type': 'Other lowland acid grassland',
      feature_uuid: PARENT_UUID,
      ...overrides
    },
    nativeGeometry: { type: 'Polygon', coordinates: [PARCEL] }
  }
}

function linkedRow(overrides = {}) {
  return {
    properties: {
      fid: 1,
      'Parcel Ref': 'H001',
      'Retention Category': 'Retained',
      'Proposed Habitat Type': 'Other lowland acid grassland',
      parent_uuid: PARENT_UUID,
      parent_geom: PARCEL_WKT,
      ...overrides
    }
  }
}

function layers(features, tables) {
  return { ...features, layerTables: tables }
}

function check({ baseline = [baselineParcel()], pi = [linkedRow()] } = {}) {
  return checkParentLinks(
    layers({ areas: baseline }, { areas: AREA_BASELINE }),
    layers({ areas: pi }, { areas: AREA_PI })
  )
}

describe('checkParentLinks', () => {
  it('passes a row linked to its parent with the parent’s shape', () => {
    expect(check()).toEqual([])
  })

  it('does not check a Created row with no parent link: it is a creation', () => {
    expect(
      check({
        pi: [
          linkedRow({
            'Retention Category': 'Created',
            parent_uuid: null,
            parent_geom: null
          }),
          linkedRow({
            fid: 2,
            'Retention Category': 'Created',
            parent_uuid: '  '
          })
        ]
      })
    ).toEqual([])
  })

  it.each(['Retained', 'Enhanced', ' enhanced '])(
    'refuses a %s row with no parent link, listing its table, ref and habitat type',
    (category) => {
      const errors = check({
        pi: [
          linkedRow(),
          linkedRow({
            fid: 2,
            'Parcel Ref': 'H007',
            'Retention Category': category,
            parent_uuid: null,
            parent_geom: null
          })
        ]
      })

      expect(errors).toEqual([
        {
          code: ERROR_CODES.STAGED_PARENT_LINK_MISSING,
          message:
            'One or more Retained or Enhanced post-intervention habitats do not name the baseline habitat they continue: Area Habitats Post-Intervention H007 (Other lowland acid grassland)',
          details: {
            count: 1,
            sample: [
              {
                layer: 'areas',
                table: AREA_PI,
                fid: 2,
                ref: 'H007',
                habitatType: 'Other lowland acid grassland',
                parentUuid: null
              }
            ]
          }
        }
      ])
    }
  )

  it('checks a Created row with a parent link like any other', () => {
    const [error] = check({
      pi: [linkedRow({ 'Retention Category': 'Created', parent_geom: null })]
    })

    expect(error.code).toBe(ERROR_CODES.STAGED_BASELINE_DRIFTED)
  })

  it('refuses a row whose parent_uuid names no baseline feature, listing its table, ref and habitat type', () => {
    const errors = check({
      pi: [
        linkedRow(),
        linkedRow({ fid: 2, 'Parcel Ref': 'H009', parent_uuid: UNKNOWN_UUID })
      ]
    })

    expect(errors).toEqual([
      {
        code: ERROR_CODES.STAGED_UNKNOWN_PARENT_REF,
        message:
          'One or more post-intervention habitats name a baseline habitat that is not in the file: Area Habitats Post-Intervention H009 (Other lowland acid grassland)',
        details: {
          count: 1,
          sample: [
            {
              layer: 'areas',
              table: AREA_PI,
              fid: 2,
              ref: 'H009',
              habitatType: 'Other lowland acid grassland',
              parentUuid: UNKNOWN_UUID
            }
          ]
        }
      }
    ])
  })

  it('looks for the parent in the row’s own layer only', () => {
    const errors = checkParentLinks(
      layers(
        { areas: [baselineParcel()], hedgerows: [] },
        { areas: AREA_BASELINE, hedgerows: HEDGE_BASELINE }
      ),
      layers(
        {
          areas: [],
          hedgerows: [
            {
              properties: {
                fid: 1,
                'Parcel Ref': 'HG001',
                'Proposed Hedge Type': 'Native hedgerow',
                parent_uuid: PARENT_UUID,
                parent_geom: PARCEL_WKT
              }
            }
          ]
        },
        { areas: AREA_PI, hedgerows: HEDGE_PI }
      )
    )

    expect(errors.map((e) => e.code)).toEqual([
      ERROR_CODES.STAGED_UNKNOWN_PARENT_REF
    ])
    expect(errors[0].details.sample[0]).toMatchObject({
      layer: 'hedgerows',
      table: HEDGE_PI,
      habitatType: 'Native hedgerow'
    })
  })

  it('refuses a row whose parent_uuid more than one baseline habitat has, listing them and the rows that name it', () => {
    const errors = check({
      baseline: [
        baselineParcel(),
        { ...baselineParcel({ fid: 2, 'Parcel Ref': 'H001 copy' }) }
      ],
      pi: [linkedRow(), linkedRow({ fid: 2, 'Parcel Ref': 'H001b' })]
    })

    expect(errors).toEqual([
      {
        code: ERROR_CODES.STAGED_AMBIGUOUS_PARENT,
        message:
          'One or more post-intervention habitats name a baseline habitat whose feature_uuid more than one baseline habitat has: Area Habitats Baseline H001, H001 copy, named by H001, H001b',
        details: {
          count: 1,
          sample: [
            {
              layer: 'areas',
              table: AREA_BASELINE,
              parentUuid: PARENT_UUID,
              refs: ['H001', 'H001 copy'],
              habitatType: 'Other lowland acid grassland',
              childRefs: ['H001', 'H001b']
            }
          ]
        }
      }
    ])
  })

  it('accepts a baseline uuid two habitats share when no row names it', () => {
    expect(
      check({
        baseline: [baselineParcel(), baselineParcel({ fid: 2 })],
        pi: [linkedRow({ 'Retention Category': 'Created', parent_uuid: null })]
      })
    ).toEqual([])
  })

  it('refuses a parent whose shape has moved since the copy, listing the parent and each affected row once', () => {
    const moved = PARCEL.map(([x, y]) => [x + 5, y])
    const errors = check({
      baseline: [
        {
          ...baselineParcel(),
          nativeGeometry: { type: 'Polygon', coordinates: [moved] }
        }
      ],
      pi: [
        linkedRow({ 'Parcel Ref': 'H001' }),
        linkedRow({ fid: 2, 'Parcel Ref': 'H001' })
      ]
    })

    expect(errors).toEqual([
      {
        code: ERROR_CODES.STAGED_BASELINE_DRIFTED,
        message:
          'One or more baseline habitats do not have the shape their post-intervention habitats were copied from: Area Habitats Baseline H001 (Other lowland acid grassland), copied to H001, H001',
        details: {
          count: 1,
          sample: [
            {
              layer: 'areas',
              table: AREA_BASELINE,
              fid: 1,
              ref: 'H001',
              habitatType: 'Other lowland acid grassland',
              childRefs: ['H001', 'H001']
            }
          ]
        }
      }
    ])
  })

  it.each([
    ['missing', null],
    ['empty', '   '],
    ['not valid WKT', 'Polygon ((529508.048 179859.011, oops))'],
    ['an empty geometry', 'POLYGON EMPTY'],
    [
      'over the length limit',
      `${PARCEL_WKT}${' '.repeat(MAX_PARENT_GEOM_CHARS)}`
    ]
  ])(
    'refuses a linked row whose parent_geom is %s, as it cannot be checked',
    (_, parentGeom) => {
      const [error] = check({ pi: [linkedRow({ parent_geom: parentGeom })] })

      expect(error.code).toBe(ERROR_CODES.STAGED_BASELINE_DRIFTED)
      expect(error.details.sample[0].childRefs).toEqual(['H001'])
    }
  )

  it.each([
    [
      'in another case and with Python’s spelling',
      PARCEL_WKT.replace('Polygon', 'POLYGON')
    ],
    [
      'as a one-part MultiPolygon',
      'MULTIPOLYGON (((529508.048 179859.011, 529517.537 179845.590, 529693.765 179940.714, 529508.048 179859.011)))'
    ],
    [
      'with a vertex topological editing added on an edge',
      'Polygon ((529508.048 179859.011, 529517.537 179845.590, 529605.651 179893.152, 529693.765 179940.714, 529508.048 179859.011))'
    ],
    [
      'a millimetre off, as a writer rounds a midpoint the other way',
      'Polygon ((529508.049 179859.011, 529517.537 179845.590, 529693.765 179940.714, 529508.048 179859.011))'
    ]
  ])('matches the parent’s shape recorded %s', (_, parentGeom) => {
    expect(check({ pi: [linkedRow({ parent_geom: parentGeom })] })).toEqual([])
  })

  it('refuses a recorded shape 2 mm off the parent’s', () => {
    const [error] = check({
      pi: [
        linkedRow({
          parent_geom:
            'Polygon ((529508.050 179859.011, 529517.537 179845.590, 529693.765 179940.714, 529508.050 179859.011))'
        })
      ]
    })

    expect(error.code).toBe(ERROR_CODES.STAGED_BASELINE_DRIFTED)
  })

  it('checks linear habitats as well as areas', () => {
    const hedge = (coordinates) => ({
      properties: {
        fid: 1,
        'Parcel Ref': 'HG001',
        'Baseline Hedge Type': 'Native hedgerow',
        feature_uuid: HEDGE_UUID
      },
      nativeGeometry: { type: 'LineString', coordinates }
    })
    const row = {
      properties: {
        fid: 1,
        'Parcel Ref': 'HG001',
        parent_uuid: HEDGE_UUID,
        parent_geom: HEDGE_WKT
      }
    }
    const run = (coordinates) =>
      checkParentLinks(
        layers(
          { hedgerows: [hedge(coordinates)] },
          { hedgerows: HEDGE_BASELINE }
        ),
        layers({ hedgerows: [row] }, { hedgerows: HEDGE_PI })
      )

    expect(run(HEDGE)).toEqual([])
    expect(
      run([HEDGE[0], [529773.868, 180070.227]]).map((e) => e.code)
    ).toEqual([ERROR_CODES.STAGED_BASELINE_DRIFTED])
  })

  it('reports every problem in one file, one error each', () => {
    const errors = check({
      pi: [
        linkedRow({ parent_uuid: UNKNOWN_UUID }),
        linkedRow({ fid: 2, parent_geom: null }),
        linkedRow({ fid: 3, parent_uuid: null })
      ]
    })

    expect(errors.map((e) => e.code)).toEqual([
      ERROR_CODES.STAGED_PARENT_LINK_MISSING,
      ERROR_CODES.STAGED_UNKNOWN_PARENT_REF,
      ERROR_CODES.STAGED_BASELINE_DRIFTED
    ])
  })

  it('reads layers the file has no table for as empty', () => {
    expect(checkParentLinks({ layerTables: {} }, { layerTables: {} })).toEqual(
      []
    )
  })
})
