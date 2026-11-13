import { UNENHANCEABLE_BASELINE } from 'bng-library/metric'
import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import {
  refuseUnenhanceableBaselines,
  refuseUnenhanceableFeatures,
  refuseUnenhanceableTrees
} from './refuse-unenhanceable-baselines.js'

const SAMPLE_CAP = 50

function enhanced(ref, baseline, retentionCategory = 'Enhanced') {
  return {
    ref,
    retentionCategory,
    baseline,
    proposed: { ...baseline }
  }
}

function area(ref, type, condition, broadType = 'Grassland') {
  return enhanced(ref, { broadType, type, condition })
}

function linear(ref, type, condition) {
  return enhanced(ref, { type, condition })
}

/** The refusal that checks a layer: trees have their own. */
const refusalFor = (layer) =>
  layer === 'trees' ? refuseUnenhanceableTrees : refuseUnenhanceableBaselines

describe('refuseUnenhanceableFeatures', () => {
  const goodTree = area('T1', 'Rural tree', 'Good', 'Individual trees')
  const goodGrassland = area('H1', 'Other neutral grassland', 'Good')

  it('refuses a file with both with an error for each', () => {
    expect(
      refuseUnenhanceableFeatures({
        habitats: [goodGrassland],
        trees: [goodTree]
      }).map((error) => error.code)
    ).toEqual([
      ERROR_CODES.BASELINE_NOT_ENHANCEABLE,
      ERROR_CODES.TREE_NOT_ENHANCEABLE
    ])
  })

  it('refuses a file with one with that error alone, and accepts one with neither', () => {
    expect(
      refuseUnenhanceableFeatures({ trees: [goodTree] }).map((e) => e.code)
    ).toEqual([ERROR_CODES.TREE_NOT_ENHANCEABLE])
    expect(
      refuseUnenhanceableFeatures({
        habitats: [area('H1', 'Other neutral grassland', 'Moderate')]
      })
    ).toBeNull()
  })
})

describe('refuseUnenhanceableBaselines', () => {
  it('AC1 refuses an enhanced Medium area habitat in Good condition', () => {
    const error = refuseUnenhanceableBaselines({
      habitats: [area('H1', 'Other neutral grassland', 'Good')]
    })

    expect(error).toEqual({
      code: ERROR_CODES.BASELINE_NOT_ENHANCEABLE,
      message:
        'One or more habitats are enhanced, but their baseline habitat cannot be enhanced in this service: Feature Ref H1',
      details: {
        count: 1,
        sample: [
          {
            layer: 'habitats',
            feature_ref: 'H1',
            habitat_type: 'Grassland - Other neutral grassland',
            condition: 'Good',
            distinctiveness: 'Medium',
            proposed_habitat_type: 'Grassland - Other neutral grassland',
            proposed_condition: 'Good',
            rule: UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD,
            mvsOnly: true
          }
        ]
      }
    })
  })

  it('AC2 refuses an enhanced Medium hedgerow in Good condition', () => {
    const error = refuseUnenhanceableBaselines({
      hedgerows: [linear('HG1', 'Native hedgerow with trees', 'Good')]
    })

    expect(error.details.sample).toEqual([
      expect.objectContaining({
        layer: 'hedgerows',
        feature_ref: 'HG1',
        rule: UNENHANCEABLE_BASELINE.MEDIUM_HEDGEROW_GOOD,
        mvsOnly: true
      })
    ])
  })

  it('AC3 refuses an enhanced Medium watercourse in Good condition', () => {
    const error = refuseUnenhanceableBaselines({
      watercourses: [linear('R1', 'Ditches', 'Good')]
    })

    expect(error.details.sample).toEqual([
      expect.objectContaining({
        layer: 'watercourses',
        feature_ref: 'R1',
        rule: UNENHANCEABLE_BASELINE.MEDIUM_WATERCOURSE_GOOD,
        mvsOnly: true
      })
    ])
  })

  it.each(['Poor', 'Good'])(
    'AC4 refuses an enhanced Very Low hedgerow in %s condition',
    (condition) => {
      const error = refuseUnenhanceableBaselines({
        hedgerows: [
          linear('HG1', 'Non-native and ornamental hedgerow', condition)
        ]
      })

      expect(error.details.sample).toEqual([
        expect.objectContaining({
          rule: UNENHANCEABLE_BASELINE.VERY_LOW_HEDGEROW,
          mvsOnly: false
        })
      ])
    }
  )

  it('AC5 accepts an enhanced Low hedgerow in Good condition that can become a Medium hedgerow', () => {
    expect(
      refuseUnenhanceableBaselines({
        hedgerows: [linear('HG1', 'Native hedgerow', 'Good')]
      })
    ).toBeNull()
  })

  it('names the habitat and condition each one is enhanced into', () => {
    const error = refuseUnenhanceableBaselines({
      hedgerows: [
        {
          ...linear('HG1', 'Non-native and ornamental hedgerow', 'Poor'),
          proposed: { type: 'Native hedgerow', condition: '3. Good' }
        }
      ]
    })

    expect(error.details.sample[0]).toMatchObject({
      habitat_type: 'Non-native and ornamental hedgerow',
      condition: 'Poor',
      proposed_habitat_type: 'Native hedgerow',
      proposed_condition: 'Good'
    })
  })

  it('keeps a proposed habitat the metric does not know, as the file gives it', () => {
    const error = refuseUnenhanceableBaselines({
      habitats: [
        {
          ...area('H1', 'Other neutral grassland', 'Good'),
          proposed: { broadType: 'Grassland', type: 'Not a grassland' }
        }
      ]
    })

    expect(error.details.sample[0]).toMatchObject({
      proposed_habitat_type: 'Grassland - Not a grassland',
      proposed_condition: null
    })
  })

  it('keeps a proposed condition the metric does not know, as the file gives it', () => {
    const error = refuseUnenhanceableBaselines({
      habitats: [
        {
          ...area('H1', 'Other neutral grassland', 'Good'),
          proposed: {
            broadType: 'Grassland',
            type: 'Other neutral grassland',
            condition: '2. Fairly good'
          }
        }
      ]
    })

    expect(error.details.sample[0]).toMatchObject({
      proposed_habitat_type: 'Grassland - Other neutral grassland',
      proposed_condition: 'Fairly good'
    })
  })

  it.each([
    ['habitats', area('H1', 'Other neutral grassland', 'Good')],
    ['trees', area('T1', 'Other neutral grassland', 'Good')],
    ['hedgerows', linear('HG1', 'Non-native and ornamental hedgerow', 'Poor')],
    ['watercourses', linear('R1', 'Ditches', 'Good')]
  ])(
    'names no proposed habitat or condition for %s with no proposed side',
    (layer, feature) => {
      delete feature.proposed

      const error = refusalFor(layer)({ [layer]: [feature] })

      expect(error.details.sample[0]).toMatchObject({
        layer,
        proposed_habitat_type: null,
        proposed_condition: null
      })
    }
  )

  it('reads a condition with its list number', () => {
    const error = refuseUnenhanceableBaselines({
      habitats: [area('H1', 'Other neutral grassland', '3. Good')]
    })

    expect(error.details.sample[0].condition).toBe('Good')
  })

  it('reads the intervention type from the baseline when the feature has none at its root', () => {
    const habitat = area('H1', 'Other neutral grassland', 'Good')
    delete habitat.retentionCategory
    habitat.baseline.retentionCategory = 'Enhanced'

    expect(refuseUnenhanceableBaselines({ habitats: [habitat] })).not.toBeNull()
  })

  it('lists every offending habitat in one error', () => {
    const error = refuseUnenhanceableBaselines({
      habitats: [
        area('H1', 'Other neutral grassland', 'Good'),
        area('H2', 'Other neutral grassland', 'Moderate')
      ],
      hedgerows: [linear('HG1', 'Non-native and ornamental hedgerow', 'Poor')],
      watercourses: [linear('R1', 'Canals', 'Good')]
    })

    expect(error.details.count).toBe(3)
    expect(error.details.sample.map((s) => s.feature_ref)).toEqual([
      'H1',
      'HG1',
      'R1'
    ])
    expect(error.message).toMatch(
      /Feature Ref H1, Feature Ref HG1, Feature Ref R1$/
    )
  })

  it('caps the sample and counts the rest', () => {
    const habitats = Array.from({ length: SAMPLE_CAP + 2 }, (_, i) =>
      area(`H${i}`, 'Other neutral grassland', 'Good')
    )

    const error = refuseUnenhanceableBaselines({ habitats })

    expect(error.details.count).toBe(SAMPLE_CAP + 2)
    expect(error.details.sample).toHaveLength(SAMPLE_CAP)
    expect(error.message).toMatch(/\(and 2 more\)$/)
  })

  it.each([
    [
      'habitats',
      area(undefined, 'Other neutral grassland', 'Good'),
      'an area habitat'
    ],
    [
      'hedgerows',
      linear('', 'Native hedgerow with trees', 'Good'),
      'a hedgerow'
    ],
    ['watercourses', linear(undefined, 'Ditches', 'Good'), 'a watercourse'],
    ['trees', area(null, 'Rural tree', 'Good', 'Individual trees'), 'a tree']
  ])('names a feature on %s with no ref as %j', (layer, feature, label) => {
    const error = refusalFor(layer)({ [layer]: [feature] })

    expect(error.message).toMatch(new RegExp(`: ${label}$`))
  })

  it.each(['Retained', 'Lost', 'Created'])(
    'accepts a %s habitat whose baseline cannot be enhanced',
    (retentionCategory) => {
      expect(
        refuseUnenhanceableBaselines({
          habitats: [
            enhanced(
              'H1',
              {
                broadType: 'Grassland',
                type: 'Other neutral grassland',
                condition: 'Good'
              },
              retentionCategory
            )
          ]
        })
      ).toBeNull()
    }
  )

  it.each([
    ['a Medium area habitat in Moderate condition', 'Moderate'],
    ['an unknown condition', 'Excellent'],
    ['no condition', null]
  ])('accepts an enhanced baseline with %s', (_, condition) => {
    expect(
      refuseUnenhanceableBaselines({
        habitats: [area('H1', 'Other neutral grassland', condition)]
      })
    ).toBeNull()
  })

  it('leaves an unknown baseline habitat to the checks that own it', () => {
    expect(
      refuseUnenhanceableBaselines({
        habitats: [area('H1', 'Not a grassland', 'Good')]
      })
    ).toBeNull()
  })

  it.each(['Rural tree', 'Urban tree'])(
    'refuses an enhanced %s in Good condition with its own error, a Medium area habitat',
    (type) => {
      const error = refuseUnenhanceableTrees({
        trees: [area('T1', type, 'Good', 'Individual trees')]
      })

      expect(error.code).toBe(ERROR_CODES.TREE_NOT_ENHANCEABLE)
      expect(error.message).toBe(
        'One or more trees are enhanced, but their baseline tree is in Good condition and cannot be enhanced: record each as Retained, or, if its condition will get worse, as lost and Created in a lower condition 30+ years in advance: Feature Ref T1'
      )
      expect(error.details.sample).toEqual([
        expect.objectContaining({
          layer: 'trees',
          feature_ref: 'T1',
          habitat_type: `Individual trees - ${type}`,
          rule: UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD
        })
      ])
    }
  )

  it('accepts an enhanced tree in Moderate condition', () => {
    expect(
      refuseUnenhanceableTrees({
        trees: [area('T1', 'Rural tree', 'Moderate', 'Individual trees')]
      })
    ).toBeNull()
  })

  it('leaves trees to refuseUnenhanceableTrees, and the other habitats to it', () => {
    const goodTree = area('T1', 'Rural tree', 'Good', 'Individual trees')
    const goodGrassland = area('H1', 'Other neutral grassland', 'Good')

    expect(refuseUnenhanceableBaselines({ trees: [goodTree] })).toBeNull()
    expect(refuseUnenhanceableTrees({ habitats: [goodGrassland] })).toBeNull()
  })

  describe('a row linked to its parent in the baseline (BNG Service template)', () => {
    const PARENT_ID = '11111111-1111-4111-8111-000000000001'

    function linked(rowCondition) {
      return {
        ...area('H1', 'Other neutral grassland', rowCondition),
        parentFeatureId: PARENT_ID
      }
    }

    function baselineWithParent(condition) {
      return {
        habitats: [
          {
            featureId: PARENT_ID,
            ref: 'H1',
            broadType: 'Grassland',
            type: 'Other neutral grassland',
            condition
          }
        ]
      }
    }

    it("is checked against its parent's condition, not the row's copy", () => {
      const error = refuseUnenhanceableBaselines(
        { habitats: [linked('Moderate')] },
        baselineWithParent('Good')
      )

      expect(error.details.sample).toEqual([
        expect.objectContaining({ feature_ref: 'H1', condition: 'Good' })
      ])
    })

    it("is accepted when its parent can be enhanced, whatever the row's copy says", () => {
      expect(
        refuseUnenhanceableBaselines(
          { habitats: [linked('Good')] },
          baselineWithParent('Moderate')
        )
      ).toBeNull()
    })

    it('falls back to its own Baseline columns when the parent is not in the baseline', () => {
      expect(
        refuseUnenhanceableBaselines(
          { habitats: [linked('Good')] },
          { habitats: [] }
        )
      ).not.toBeNull()
    })
  })

  it('copes with a document missing layers', () => {
    expect(refuseUnenhanceableBaselines({})).toBeNull()
    expect(refuseUnenhanceableBaselines(null)).toBeNull()
  })
})
