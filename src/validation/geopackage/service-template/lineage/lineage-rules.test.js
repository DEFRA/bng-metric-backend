import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../../errors.js'
import { checkLineageRules } from './lineage-rules.js'

const TABLES = {
  baseline: {
    areas: 'Area Habitats Baseline',
    verticalHabitats: 'Vertical Area Habitats Baseline',
    hedgerows: 'Hedgerows Baseline',
    watercourses: 'Watercourses Baseline',
    trees: 'Individual Trees Baseline'
  },
  postIntervention: {
    areas: 'Area Habitats Post-Intervention',
    verticalHabitats: 'Vertical Area Habitats Post-Intervention',
    hedgerows: 'Hedgerows Post-Intervention',
    watercourses: 'Watercourses Post-Intervention',
    trees: 'Individual Trees Post-Intervention'
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

/** A green wall along a line, with its area typed in, in hectares. */
function wall(n, hectares, overrides = {}) {
  return {
    properties: {
      fid: n,
      'Parcel Ref': `V00${n}`,
      'Baseline Broad Habitat Type': 'Urban',
      'Baseline Habitat Type': 'Facade-bound green wall',
      'Baseline Condition': 'Moderate',
      Area: hectares,
      feature_uuid: uuid(300 + n),
      ...overrides
    },
    nativeGeometry: line(10)
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

const POINT = { type: 'Point', coordinates: [50, 50] }

/** A baseline tree point: one tree. */
function tree(n, overrides = {}) {
  return {
    properties: {
      fid: n,
      'Tree Ref': `T00${n}`,
      'Baseline Tree Size': 'Medium',
      'Baseline Rural or Urban Tree': 'Urban tree',
      'Baseline Condition': 'Moderate',
      feature_uuid: uuid(400 + n),
      ...overrides
    },
    nativeGeometry: POINT
  }
}

/** A post-intervention tree copied from `parent`, Retained unless overridden. */
function treeChild(parent, overrides = {}) {
  return {
    properties: {
      fid: parent.properties.fid,
      'Tree Ref': parent.properties['Tree Ref'],
      'Retention Category': 'Retained',
      'Proposed Tree Size': parent.properties['Baseline Tree Size'],
      'Proposed Rural or Urban Tree':
        parent.properties['Baseline Rural or Urban Tree'],
      'Proposed Condition': parent.properties['Baseline Condition'],
      parent_uuid: parent.properties.feature_uuid,
      ...overrides
    },
    nativeGeometry: POINT
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
    verticalHabitats: {
      'Proposed Broad Habitat Type': 'Urban',
      'Proposed Habitat Type':
        parent.properties['Baseline Habitat Type'] ?? null,
      Area: parent.properties.Area
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

  describe('vertical area habitats', () => {
    it('passes children whose typed areas together are no more than their parent’s', () => {
      const parent = wall(1, 0.004)

      expect(
        check(
          { verticalHabitats: [parent] },
          {
            verticalHabitats: [
              child(parent, 'verticalHabitats', {
                'Parcel Ref': 'V001a',
                Area: 0.0025
              }),
              child(parent, 'verticalHabitats', {
                'Parcel Ref': 'V001b',
                'Retention Category': 'Enhanced',
                Area: 0.0015
              })
            ]
          }
        )
      ).toEqual([])
    })

    it('passes a baseline vertical area habitat with no child: it is removed', () => {
      expect(check({ verticalHabitats: [wall(1, 0.004)] }, {})).toEqual([])
    })

    it('refuses a parent smaller than its children together, counting a Created child', () => {
      const parent = wall(1, 0.004)

      const errors = check(
        { verticalHabitats: [parent] },
        {
          verticalHabitats: [
            child(parent, 'verticalHabitats', { 'Parcel Ref': 'V001a' }),
            child(parent, 'verticalHabitats', {
              'Parcel Ref': 'V001b',
              'Retention Category': 'Created',
              'Proposed Habitat Type': 'Ground based green wall',
              Area: 0.00101
            })
          ]
        }
      )

      expect(errors).toEqual([
        {
          code: ERROR_CODES.STAGED_VERTICAL_CHILDREN_TOO_LARGE,
          message:
            'One or more baseline vertical area habitats have a smaller Area (ha) than the post-intervention vertical area habitats linked to them together: Vertical Area Habitats Baseline V001 (Facade-bound green wall), copied to V001a, V001b (0.004 ha, linked 0.00501 ha)',
          details: {
            count: 1,
            sample: [
              {
                layer: 'verticalHabitats',
                table: 'Vertical Area Habitats Baseline',
                fid: 1,
                ref: 'V001',
                habitatType: 'Facade-bound green wall',
                childRefs: ['V001a', 'V001b'],
                areaSquareMetres: 40,
                childAreaSquareMetres: 50.1
              }
            ]
          }
        }
      ])
    })

    it('reads a row’s area from Area only, never Shape_Area, as the upload check and the extract do', () => {
      const parent = wall(1, 0.004)
      // Shape_Area is in the CRS's square metres: read as hectares, these
      // children would be far larger than their parent.
      const piece = (ref, squareMetres) =>
        child(parent, 'verticalHabitats', {
          'Parcel Ref': ref,
          Area: undefined,
          Shape_Area: squareMetres
        })

      expect(
        check(
          { verticalHabitats: [parent] },
          { verticalHabitats: [piece('V001a', 25), piece('V001b', 25)] }
        )
      ).toEqual([])
    })

    it('passes a vertical area habitat Created in its own type, whatever its condition or advance', () => {
      const parent = wall(1, 40)

      for (const overrides of [
        {
          'Proposed Condition': 'Poor',
          'Habitat created in advance/years': '0'
        },
        {}
      ]) {
        expect(
          check(
            { verticalHabitats: [parent] },
            {
              verticalHabitats: [
                degraded(parent, 'verticalHabitats', {
                  'Parcel Ref': 'V001a',
                  ...overrides
                })
              ]
            }
          )
        ).toEqual([])
      }
    })
  })

  describe('individual trees', () => {
    /** A Newly Planted tree linked to `parent`: planting in its place. */
    const plantedTree = (parent, ref) =>
      treeChild(parent, {
        'Tree Ref': ref,
        'Retention Category': 'Created',
        Category: 'Newly Planted'
      })

    it.each(['Retained', 'Enhanced'])(
      'passes a tree kept by one %s point, whatever is planted in its place',
      (retentionCategory) => {
        const parent = tree(1)

        expect(
          check(
            { trees: [parent] },
            {
              trees: [
                treeChild(parent, {
                  'Tree Ref': 'T001a',
                  'Retention Category': retentionCategory,
                  'Proposed Condition':
                    retentionCategory === 'Enhanced' ? 'Good' : 'Moderate'
                }),
                plantedTree(parent, 'T001b'),
                plantedTree(parent, 'T001c')
              ]
            }
          )
        ).toEqual([])
      }
    )

    it('passes a baseline tree with no child: it is felled', () => {
      expect(check({ trees: [tree(1)] }, { trees: [] })).toEqual([])
    })

    it('refuses a tree kept by more than one point, as a point is one tree', () => {
      const parent = tree(1)

      const errors = check(
        { trees: [parent] },
        {
          trees: [
            treeChild(parent, { 'Tree Ref': 'T001a' }),
            treeChild(parent, {
              'Tree Ref': 'T001b',
              'Retention Category': 'Enhanced',
              'Proposed Condition': 'Good'
            }),
            plantedTree(parent, 'T001c')
          ]
        }
      )

      expect(errors).toEqual([
        {
          code: ERROR_CODES.STAGED_TREE_CHILDREN_TOO_MANY,
          message:
            'One or more baseline trees have more than one Retained or Enhanced tree linked to them. A baseline tree is one tree, so only one Retained or Enhanced tree can be linked to it: Individual Trees Baseline T001 (Urban tree), copied to T001a, T001b',
          details: {
            count: 1,
            sample: [
              {
                layer: 'trees',
                table: 'Individual Trees Baseline',
                fid: 1,
                ref: 'T001',
                habitatType: 'Urban tree',
                childRefs: ['T001a', 'T001b']
              }
            ]
          }
        }
      ])
    })

    it('does not hold a Newly Planted tree linked to a parent to the guide’s steps for a tree that gets worse: it is planting', () => {
      const parent = tree(1)

      expect(
        check(
          { trees: [parent] },
          {
            trees: [
              treeChild(parent, {
                'Retention Category': 'Created',
                Category: 'Newly Planted',
                'Proposed Condition': 'Moderate'
              })
            ]
          }
        )
      ).toEqual([])
    })

    /** The parent tree recorded as lost, and Created again as Existing. */
    const existingCreated = (parent, overrides = {}) =>
      treeChild(parent, {
        'Retention Category': 'Created',
        Category: 'Existing',
        'Proposed Condition': 'Poor',
        'Habitat Created/Enhanced in advance/years': '30+',
        ...overrides
      })

    it.each([
      ['in a lower condition, 30+ years in advance', {}],
      // "30+" is 30 years, as the import parses it and the edit rule reads
      // it (apply-feature-update.test.js).
      [
        'in a lower condition, 30 years in advance as text',
        { 'Habitat Created/Enhanced in advance/years': '30' }
      ],
      [
        'in a lower condition, 30 years in advance as a number',
        { 'Habitat Created/Enhanced in advance/years': 30 }
      ],
      [
        'in the other setting, in a lower condition, 30+ years in advance',
        { 'Proposed Rural or Urban Tree': 'Rural tree' }
      ],
      [
        'put back after a delay, in the same condition, not in advance',
        {
          'Proposed Condition': 'Moderate',
          'Habitat Created/Enhanced in advance/years': '0',
          'Delay in starting habitat creation/enhancement in years': '5'
        }
      ],
      [
        'with no Proposed Condition, left Incomplete',
        { 'Proposed Condition': null }
      ]
    ])('passes an Existing tree Created over its parent %s', (_, overrides) => {
      const parent = tree(1)

      expect(
        check(
          { trees: [parent] },
          { trees: [existingCreated(parent, overrides)] }
        )
      ).toEqual([])
    })

    it.each([
      ['in the same condition', { 'Proposed Condition': 'Moderate' }],
      ['in a better condition', { 'Proposed Condition': 'Good' }],
      [
        'in a lower condition, 5 years in advance',
        { 'Habitat Created/Enhanced in advance/years': '5' }
      ],
      [
        'in a lower condition, 29 years in advance',
        { 'Habitat Created/Enhanced in advance/years': 29 }
      ],
      [
        'in a lower condition, with no years in advance',
        { 'Habitat Created/Enhanced in advance/years': null }
      ]
    ])(
      'refuses an Existing tree Created over its parent %s, with no delay, naming it and its parent',
      (_, overrides) => {
        const parent = tree(1)

        const errors = check(
          { trees: [parent] },
          {
            trees: [
              existingCreated(parent, { 'Tree Ref': 'T001a', ...overrides })
            ]
          }
        )

        expect(errors).toEqual([
          {
            code: ERROR_CODES.STAGED_TREE_DEGRADE_NOT_VALID,
            message:
              'One or more Existing trees are Created over their baseline tree, but not in a lower condition or not created 30+ years in advance, as the Metric guide asks for a tree whose condition gets worse. Lower its condition and set its years created in advance to 30+, or, if it is a new tree planted in its place, set its Category to Newly Planted: Individual Trees Post-Intervention T001a (Urban tree), copied from T001',
            details: {
              count: 1,
              sample: [
                {
                  layer: 'trees',
                  table: 'Individual Trees Post-Intervention',
                  fid: 1,
                  ref: 'T001a',
                  habitatType: 'Urban tree',
                  parentRef: 'T001'
                }
              ]
            }
          }
        ])
      }
    )

    it('holds an Existing tree Created in the other setting to the same steps: it is still its baseline tree', () => {
      const parent = tree(1)

      const errors = check(
        { trees: [parent] },
        {
          trees: [
            existingCreated(parent, {
              'Proposed Rural or Urban Tree': 'Rural tree',
              'Proposed Condition': 'Moderate'
            })
          ]
        }
      )

      expect(codes(errors)).toEqual([ERROR_CODES.STAGED_TREE_DEGRADE_NOT_VALID])
      expect(errors[0].details.sample[0]).toMatchObject({
        ref: 'T001',
        habitatType: 'Rural tree',
        parentRef: 'T001'
      })
    })

    it('does not count an Existing tree Created against its parent’s one kept tree', () => {
      const parent = tree(1)

      expect(
        check(
          { trees: [parent] },
          {
            trees: [
              treeChild(parent, { 'Tree Ref': 'T001a' }),
              existingCreated(parent, { 'Tree Ref': 'T001b' })
            ]
          }
        )
      ).toEqual([])
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

  // A habitat that gets worse is recorded as its parent lost and a creation
  // (guide, "Habitat retention"). The file is not refused for how the creation
  // compares with its parent: the same row may be a degrade or a habitat
  // cleared and created again, which only the ecologist can tell apart.
  describe('a Created row of its parent’s own type', () => {
    it.each([
      ['an area habitat', 'areas', () => parcel(1)],
      ['a hedgerow', 'hedgerows', () => hedge(1, 100)],
      ['a vertical area habitat', 'verticalHabitats', () => wall(1, 40)]
    ])(
      'passes %s however it compares with its parent',
      (_, layer, parentOf) => {
        const parent = parentOf()

        for (const overrides of [
          // Its parent's condition, with no delay or advance.
          { 'Habitat created in advance/years': '0' },
          // A better condition.
          { 'Proposed Condition': 'Good' },
          // A lower condition, not 30+ years in advance.
          {
            'Proposed Condition': 'Poor',
            'Habitat created in advance/years': '5'
          },
          {
            'Proposed Condition': 'Poor',
            'Habitat created in advance/years': null
          }
        ]) {
          expect(
            check(
              { [layer]: [parent] },
              { [layer]: [degraded(parent, layer, overrides)] }
            ),
            JSON.stringify(overrides)
          ).toEqual([])
        }
      }
    )

    it('passes a habitat the Metric gives no condition score, Created in its own type', () => {
      const parent = parcel(1, { 'Baseline Condition': 'N/A - Other' })

      expect(
        check(
          { areas: [parent] },
          {
            areas: [
              degraded(parent, 'areas', {
                'Proposed Condition': 'N/A - Other',
                'Habitat created in advance/years': '0'
              })
            ]
          }
        )
      ).toEqual([])
    })

    it('passes a watercourse Created in its own River Type with no change, whole or in pieces', () => {
      const parent = river(1, 100)
      const piece = (fid, ref, metres, from = 0) =>
        degraded(parent, 'watercourses', {
          fid,
          'Parcel Ref': ref,
          'Habitat created in advance/years': '0',
          geometry: line(metres, from)
        })

      expect(
        check(
          { watercourses: [parent] },
          { watercourses: [piece(1, 'R001', 100)] }
        )
      ).toEqual([])
      expect(
        check(
          { watercourses: [parent] },
          {
            watercourses: [piece(1, 'R001a', 50), piece(2, 'R001b', 50, 50)]
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
