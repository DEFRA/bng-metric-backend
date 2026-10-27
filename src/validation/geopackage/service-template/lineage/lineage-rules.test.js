import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../../errors.js'
import { checkLineageRules } from './lineage-rules.js'

const TABLES = {
  baseline: {
    areas: 'Area Habitats Baseline',
    hedgerows: 'Hedgerows Baseline',
    watercourses: 'Watercourses Baseline'
  },
  postIntervention: {
    areas: 'Area Habitats Post-Intervention',
    hedgerows: 'Hedgerows Post-Intervention',
    watercourses: 'Watercourses Post-Intervention'
  }
}

const PARCEL = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 0]
    ]
  ]
}

/** A straight line along the x axis, `metres` long. */
const line = (metres, from = 0) => ({
  type: 'LineString',
  coordinates: [
    [from, 0],
    [from + metres, 0]
  ]
})

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function parcel(n, overrides = {}) {
  return {
    properties: {
      fid: n,
      'Parcel Ref': `H00${n}`,
      'Baseline Broad Habitat Type': 'Grassland',
      'Baseline Habitat Type': 'Other neutral grassland',
      'Baseline Condition': 'Moderate',
      feature_uuid: uuid(n),
      ...overrides
    },
    nativeGeometry: PARCEL
  }
}

function hedge(n, metres, overrides = {}) {
  return {
    properties: {
      fid: n,
      'Parcel Ref': `HG00${n}`,
      'Baseline Hedge Type': 'Native hedgerow',
      'Baseline Condition': 'Good',
      feature_uuid: uuid(100 + n),
      ...overrides
    },
    nativeGeometry: line(metres)
  }
}

function river(n, metres, overrides = {}) {
  return {
    properties: {
      fid: n,
      'Parcel Ref': `R00${n}`,
      'Baseline River Type': 'Ditches',
      'Baseline Condition': 'Moderate',
      'Baseline Encroachment into Watercourse': 'No Encroachment',
      'Baseline Encroachment into riparian zone':
        'No Encroachment/No Encroachment',
      feature_uuid: uuid(200 + n),
      ...overrides
    },
    nativeGeometry: line(metres)
  }
}

/** A post-intervention row copied from `parent`, Retained unless overridden. */
function child(parent, layer, { geometry, ...overrides } = {}) {
  const proposed = {
    areas: {
      'Proposed Broad Habitat Type': 'Grassland',
      'Proposed Habitat Type':
        parent.properties['Baseline Habitat Type'] ?? null
    },
    hedgerows: {
      'Proposed Hedge Type': parent.properties['Baseline Hedge Type'] ?? null
    },
    watercourses: {
      'Proposed River Type': parent.properties['Baseline River Type'] ?? null,
      'Proposed Encroachment into Watercourse':
        parent.properties['Baseline Encroachment into Watercourse'],
      'Proposed Encroachment into riparian zone':
        parent.properties['Baseline Encroachment into riparian zone']
    }
  }[layer]
  return {
    properties: {
      fid: parent.properties.fid,
      'Parcel Ref': parent.properties['Parcel Ref'],
      'Retention Category': 'Retained',
      'Proposed Condition': parent.properties['Baseline Condition'],
      ...proposed,
      parent_uuid: parent.properties.feature_uuid,
      ...overrides
    },
    nativeGeometry: geometry ?? parent.nativeGeometry
  }
}

/** A Created row of its parent's type, linked to it: a degraded row. */
const degraded = (parent, layer, overrides = {}) =>
  child(parent, layer, {
    'Retention Category': 'Created',
    'Habitat created in advance/years': '30+',
    ...overrides
  })

function check(baseline, postIntervention) {
  return checkLineageRules(
    { ...baseline, layerTables: TABLES.baseline },
    { ...postIntervention, layerTables: TABLES.postIntervention }
  )
}

const codes = (errors) => errors.map((error) => error.code)

describe('checkLineageRules', () => {
  it('passes habitats that are retained, enhanced and created from nothing', () => {
    const area = parcel(1)
    const hedgerow = hedge(1, 100)
    const ditch = river(1, 100)

    expect(
      check(
        { areas: [area], hedgerows: [hedgerow], watercourses: [ditch] },
        {
          areas: [
            child(area, 'areas', { 'Retention Category': 'Enhanced' }),
            child(parcel(9), 'areas', {
              'Retention Category': 'Created',
              parent_uuid: null
            })
          ],
          hedgerows: [child(hedgerow, 'hedgerows')],
          watercourses: [child(ditch, 'watercourses')]
        }
      )
    ).toEqual([])
  })

  it('passes a baseline area habitat or hedgerow with no child: it is lost', () => {
    expect(
      check({ areas: [parcel(1)], hedgerows: [hedge(1, 50)] }, {})
    ).toEqual([])
  })

  describe('hedgerows', () => {
    it('passes children that together are their parent’s length, Created ones included', () => {
      const parent = hedge(1, 100)

      expect(
        check(
          { hedgerows: [parent] },
          {
            hedgerows: [
              child(parent, 'hedgerows', { geometry: line(60) }),
              degraded(parent, 'hedgerows', {
                'Proposed Condition': 'Poor',
                geometry: line(40, 60)
              })
            ]
          }
        )
      ).toEqual([])
    })

    it('refuses a parent shorter than its children together, counting a Created child', () => {
      const parent = hedge(1, 100)

      const errors = check(
        { hedgerows: [parent] },
        {
          hedgerows: [
            child(parent, 'hedgerows', { 'Parcel Ref': 'HG001a' }),
            child(parent, 'hedgerows', {
              'Parcel Ref': 'HG001b',
              'Retention Category': 'Created',
              'Proposed Hedge Type': 'Species-rich native hedgerow',
              geometry: line(20)
            })
          ]
        }
      )

      expect(errors).toEqual([
        {
          code: ERROR_CODES.STAGED_HEDGEROW_CHILDREN_TOO_LONG,
          message:
            'One or more baseline hedgerows are shorter than the post-intervention hedgerows linked to them together: Hedgerows Baseline HG001 (Native hedgerow), copied to HG001a, HG001b (100 m, linked 120 m)',
          details: {
            count: 1,
            sample: [
              {
                layer: 'hedgerows',
                table: 'Hedgerows Baseline',
                fid: 1,
                ref: 'HG001',
                habitatType: 'Native hedgerow',
                childRefs: ['HG001a', 'HG001b'],
                lengthMetres: 100,
                childLengthMetres: 120
              }
            ]
          }
        }
      ])
    })
  })

  describe('watercourses', () => {
    it('refuses a parent with both a Retained or Enhanced part and a Created part', () => {
      const parent = river(4, 100)

      const errors = check(
        { watercourses: [parent] },
        {
          watercourses: [
            child(parent, 'watercourses', {
              'Retention Category': 'Enhanced',
              geometry: line(50)
            }),
            degraded(parent, 'watercourses', {
              'Proposed Condition': 'Poor',
              geometry: line(50, 50)
            })
          ]
        }
      )

      expect(codes(errors)).toEqual([
        ERROR_CODES.STAGED_WATERCOURSE_RETAINED_AND_CREATED
      ])
      expect(errors[0].details.sample).toEqual([
        expect.objectContaining({
          table: 'Watercourses Baseline',
          ref: 'R004',
          habitatType: 'Ditches',
          childRefs: ['R004', 'R004']
        })
      ])
    })

    it('passes a parent whose only children are Created: it is lost in full', () => {
      const parent = river(1, 100)

      expect(
        check(
          { watercourses: [parent] },
          {
            watercourses: [
              degraded(parent, 'watercourses', { 'Proposed Condition': 'Poor' })
            ]
          }
        )
      ).toEqual([])
    })

    it.each(['Ditches', 'Canals', ' canals '])(
      'passes a %s with no child: it can be permanently lost',
      (type) => {
        expect(
          check(
            { watercourses: [river(1, 100, { 'Baseline River Type': type })] },
            {}
          )
        ).toEqual([])
      }
    )

    it.each(['Other rivers and streams', 'Priority habitat', 'Culvert'])(
      'refuses a %s with no child: natural rivers cannot be permanently lost',
      (type) => {
        const errors = check(
          {
            watercourses: [
              river(1, 100, { 'Baseline River Type': type }),
              river(2, 100)
            ]
          },
          {}
        )

        expect(errors).toEqual([
          {
            code: ERROR_CODES.STAGED_NATURAL_WATERCOURSE_LOST,
            message: `One or more baseline watercourses have no post-intervention habitat, but only a canal or a ditch can be permanently lost. Record each as Retained, Enhanced or Created: Watercourses Baseline R001 (${type})`,
            details: {
              count: 1,
              sample: [
                {
                  layer: 'watercourses',
                  table: 'Watercourses Baseline',
                  fid: 1,
                  ref: 'R001',
                  habitatType: type,
                  childRefs: []
                }
              ]
            }
          }
        ])
      }
    )

    it('passes a natural river that continues', () => {
      const parent = river(1, 100, { 'Baseline River Type': 'Culvert' })

      expect(
        check(
          { watercourses: [parent] },
          { watercourses: [child(parent, 'watercourses')] }
        )
      ).toEqual([])
    })
  })

  describe('degraded area habitats and hedgerows', () => {
    it.each([
      ['an area habitat', 'areas', parcel(1)],
      ['a hedgerow', 'hedgerows', hedge(1, 100)]
    ])(
      'passes %s Created in its own type in a lower condition, 30+ years in advance',
      (_, layer, parent) => {
        expect(
          check(
            { [layer]: [parent] },
            {
              [layer]: [
                degraded(parent, layer, { 'Proposed Condition': 'Poor' })
              ]
            }
          )
        ).toEqual([])
      }
    )

    it('refuses one in its parent’s condition or better, naming the row and its parent', () => {
      const parent = hedge(1, 100, { 'Baseline Condition': 'Moderate' })

      const errors = check(
        { hedgerows: [parent] },
        {
          hedgerows: [
            degraded(parent, 'hedgerows', { 'Parcel Ref': 'HG017' }),
            degraded(parent, 'hedgerows', {
              fid: 2,
              'Parcel Ref': 'HG018',
              'Proposed Condition': 'Good',
              geometry: line(0.001)
            })
          ]
        }
      )

      expect(errors).toEqual([
        {
          code: ERROR_CODES.STAGED_DEGRADE_NOT_WORSE,
          message:
            'One or more habitats are Created in their baseline habitat type without a lower condition. A habitat that is kept should be Retained or Enhanced; one lost for a time and put back should give its delay in starting habitat creation: Hedgerows Post-Intervention HG017 (Native hedgerow), copied from HG001; Hedgerows Post-Intervention HG018 (Native hedgerow), copied from HG001',
          details: {
            count: 2,
            sample: [
              {
                layer: 'hedgerows',
                table: 'Hedgerows Post-Intervention',
                fid: 1,
                ref: 'HG017',
                habitatType: 'Native hedgerow',
                parentRef: 'HG001'
              },
              expect.objectContaining({ ref: 'HG018' })
            ]
          }
        }
      ])
    })

    it.each([null, '', '30', '10', 'N/A'])(
      'refuses one created %j years in advance, not 30+',
      (advance) => {
        const parent = parcel(1)

        const errors = check(
          { areas: [parent] },
          {
            areas: [
              degraded(parent, 'areas', {
                'Proposed Condition': 'Poor',
                'Habitat created in advance/years': advance
              })
            ]
          }
        )

        expect(codes(errors)).toEqual([
          ERROR_CODES.STAGED_DEGRADE_ADVANCE_NOT_30_PLUS
        ])
        expect(errors[0].details.sample).toEqual([
          expect.objectContaining({
            table: 'Area Habitats Post-Intervention',
            ref: 'H001',
            parentRef: 'H001'
          })
        ])
      }
    )

    it('reports a row that is neither worse nor 30+ under both rules', () => {
      const parent = parcel(1)

      expect(
        codes(
          check(
            { areas: [parent] },
            {
              areas: [
                degraded(parent, 'areas', {
                  'Habitat created in advance/years': '0'
                })
              ]
            }
          )
        )
      ).toEqual([
        ERROR_CODES.STAGED_DEGRADE_NOT_WORSE,
        ERROR_CODES.STAGED_DEGRADE_ADVANCE_NOT_30_PLUS
      ])
    })

    it('does not treat built-over ground, Created in another type, as degraded', () => {
      const parent = parcel(1)

      expect(
        check(
          { areas: [parent] },
          {
            areas: [
              child(parent, 'areas', {
                'Retention Category': 'Created',
                'Proposed Broad Habitat Type': 'Urban',
                'Proposed Habitat Type': 'Developed land; sealed surface',
                'Proposed Condition': 'N/A - Other',
                'Habitat created in advance/years': '0'
              })
            ]
          }
        )
      ).toEqual([])
    })

    it.each([
      ['an area habitat', 'areas', parcel(1), 'Moderate'],
      ['an area habitat', 'areas', parcel(1), 'Poor'],
      ['a hedgerow', 'hedgerows', hedge(1, 100), 'Good'],
      ['a hedgerow', 'hedgerows', hedge(1, 100), 'Poor']
    ])(
      'passes %s put back after a temporary loss, in %s condition, with a delay and no years in advance',
      (_, layer, parent, condition) => {
        expect(
          check(
            { [layer]: [parent] },
            {
              [layer]: [
                degraded(parent, layer, {
                  'Proposed Condition': condition,
                  'Habitat created in advance/years': '0',
                  'Delay in starting habitat creation/years': '3'
                })
              ]
            }
          )
        ).toEqual([])
      }
    )

    it.each([null, '', '0'])(
      'still refuses a row in its parent’s condition with a %j delay under both rules',
      (delay) => {
        const parent = parcel(1)

        expect(
          codes(
            check(
              { areas: [parent] },
              {
                areas: [
                  degraded(parent, 'areas', {
                    'Habitat created in advance/years': '0',
                    'Delay in starting habitat creation/years': delay
                  })
                ]
              }
            )
          )
        ).toEqual([
          ERROR_CODES.STAGED_DEGRADE_NOT_WORSE,
          ERROR_CODES.STAGED_DEGRADE_ADVANCE_NOT_30_PLUS
        ])
      }
    )

    it('counts a habitat the Metric gives no condition score as never worse, unless it is put back', () => {
      const parent = parcel(1, {
        'Baseline Broad Habitat Type': 'Cropland',
        'Baseline Habitat Type': 'Cereal crops',
        'Baseline Condition': 'N/A - Agricultural'
      })
      const cropland = (delay) =>
        degraded(parent, 'areas', {
          'Proposed Broad Habitat Type': 'Cropland',
          'Proposed Habitat Type': 'Cereal crops',
          'Delay in starting habitat creation/years': delay
        })

      expect(
        codes(check({ areas: [parent] }, { areas: [cropland('0')] }))
      ).toEqual([ERROR_CODES.STAGED_DEGRADE_NOT_WORSE])
      expect(check({ areas: [parent] }, { areas: [cropland('3')] })).toEqual([])
    })

    it('accepts 30+ years on a row that is not degraded', () => {
      const parent = parcel(1)

      expect(
        check(
          { areas: [parent] },
          {
            areas: [
              child(parent, 'areas', {
                'Retention Category': 'Enhanced',
                'Proposed Condition': 'Good',
                'Habitat created in advance/years': '30+'
              })
            ]
          }
        )
      ).toEqual([])
    })
  })

  describe('degraded watercourses', () => {
    it.each([
      ['a lower condition', { 'Proposed Condition': 'Poor' }, 100],
      [
        'more encroachment',
        { 'Proposed Encroachment into Watercourse': 'Minor' },
        100
      ],
      ['a shorter length alone', {}, 60]
    ])('passes one with %s', (_, overrides, metres) => {
      const parent = river(1, 100)

      expect(
        check(
          { watercourses: [parent] },
          {
            watercourses: [
              degraded(parent, 'watercourses', {
                ...overrides,
                'Habitat created in advance/years': '0',
                geometry: line(metres)
              })
            ]
          }
        )
      ).toEqual([])
    })

    it('refuses one with no intervention, naming the row and its parent', () => {
      const parent = river(1, 100)

      const errors = check(
        { watercourses: [parent] },
        { watercourses: [degraded(parent, 'watercourses')] }
      )

      expect(errors).toEqual([
        {
          code: ERROR_CODES.STAGED_WATERCOURSE_NO_INTERVENTION,
          message:
            'One or more watercourses are Created in their baseline River Type with no lower condition, more encroachment or shorter length. A watercourse with no intervention should be Retained; one lost for a time and put back should give its delay in starting habitat creation: Watercourses Post-Intervention R001 (Ditches), copied from R001',
          details: {
            count: 1,
            sample: [
              {
                layer: 'watercourses',
                table: 'Watercourses Post-Intervention',
                fid: 1,
                ref: 'R001',
                habitatType: 'Ditches',
                parentRef: 'R001'
              }
            ]
          }
        }
      ])
    })

    it('passes one put back after a temporary loss, with a delay and no intervention', () => {
      const parent = river(1, 100)

      expect(
        check(
          { watercourses: [parent] },
          {
            watercourses: [
              degraded(parent, 'watercourses', {
                'Habitat created in advance/years': '0',
                'Delay in starting habitat creation/years': '3'
              })
            ]
          }
        )
      ).toEqual([])
    })

    it('does not ask a degraded watercourse for 30+ years', () => {
      const parent = river(1, 100)

      expect(
        check(
          { watercourses: [parent] },
          {
            watercourses: [
              degraded(parent, 'watercourses', {
                'Proposed Condition': 'Poor',
                'Habitat created in advance/years': null
              })
            ]
          }
        )
      ).toEqual([])
    })
  })

  it('ignores a row whose parent_uuid names no single baseline feature: the parent checks report it', () => {
    const parent = river(1, 100, { 'Baseline River Type': 'Canals' })
    const twin = river(2, 100, {
      'Baseline River Type': 'Canals',
      feature_uuid: parent.properties.feature_uuid
    })

    expect(
      check(
        { watercourses: [parent, twin] },
        {
          watercourses: [
            degraded(parent, 'watercourses'),
            degraded(parent, 'watercourses', { parent_uuid: uuid(999) })
          ]
        }
      )
    ).toEqual([])
  })
})
