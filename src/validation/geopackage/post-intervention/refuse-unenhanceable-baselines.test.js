import { UNENHANCEABLE_BASELINE } from 'bng-library/metric'
import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { refuseUnenhanceableBaselines } from './refuse-unenhanceable-baselines.js'

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

  it('names a habitat with no ref by its layer', () => {
    const error = refuseUnenhanceableBaselines({
      watercourses: [linear(undefined, 'Ditches', 'Good')]
    })

    expect(error.message).toMatch(/: a watercourses feature$/)
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

  it('does not check individual trees', () => {
    expect(
      refuseUnenhanceableBaselines({
        trees: [
          enhanced('T1', {
            broadType: 'Individual trees',
            type: 'Rural tree',
            condition: 'Good'
          })
        ]
      })
    ).toBeNull()
  })

  it('copes with a document missing layers', () => {
    expect(refuseUnenhanceableBaselines({})).toBeNull()
    expect(refuseUnenhanceableBaselines(null)).toBeNull()
  })
})
