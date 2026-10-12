// The rules themselves, one case per acceptance criterion of BMD-820, are
// tested in bng-library (src/metric/enhancement-rules.test.mjs). These cover
// reading a post-intervention feature into the labels they take.

import { ENHANCEMENT_RULE } from 'bng-library/metric'
import { describe, expect, it } from 'vitest'

import {
  ENHANCEMENT_RULE_LAYERS,
  checkFeatureEnhancement,
  enhancementRulesForLayer
} from './enhancement-rules.js'

function check(layer, baseline, proposed) {
  return checkFeatureEnhancement(layer, { baseline, proposed })
}

describe('checkFeatureEnhancement', () => {
  it('checks an area habitat whose broad habitat is a separate column', () => {
    expect(
      check(
        'habitats',
        {
          broadType: 'Grassland',
          type: 'Modified grassland',
          condition: 'Moderate'
        },
        {
          broadType: 'Grassland',
          type: 'Modified grassland',
          condition: 'Poor'
        }
      )
    ).toEqual({
      rule: ENHANCEMENT_RULE.LOW_AREA,
      valid: false,
      baseline: {
        habitat: 'Grassland - Modified grassland',
        condition: 'Moderate',
        distinctiveness: 'Low'
      },
      proposed: {
        habitat: 'Grassland - Modified grassland',
        condition: 'Poor',
        distinctiveness: 'Low'
      }
    })
  })

  it('checks an area habitat whose type carries its broad habitat', () => {
    expect(
      check(
        'habitats',
        { type: 'Grassland - Modified grassland', condition: 'Moderate' },
        { type: 'Grassland - Other neutral grassland', condition: 'Poor' }
      )
    ).toMatchObject({ rule: ENHANCEMENT_RULE.LOW_AREA, valid: true })
  })

  it('checks hedgerows', () => {
    expect(
      check(
        'hedgerows',
        { type: 'Native hedgerow', condition: 'Moderate' },
        { type: 'Native hedgerow', condition: 'Good' }
      )
    ).toMatchObject({ rule: ENHANCEMENT_RULE.LOW_HEDGEROW, valid: true })
  })

  it('checks watercourses', () => {
    expect(
      check(
        'watercourses',
        { type: 'Ditches', condition: 'Moderate' },
        { type: 'Canals', condition: 'Good' }
      )
    ).toMatchObject({ rule: ENHANCEMENT_RULE.MEDIUM_WATERCOURSE, valid: false })
  })

  it('matches habitat types ignoring case and surrounding spaces', () => {
    expect(
      check(
        'watercourses',
        { type: 'Ditches', condition: 'Moderate' },
        { type: ' ditches ', condition: 'Good' }
      )
    ).toMatchObject({
      valid: true,
      proposed: { habitat: 'Ditches' }
    })
  })

  it('strips the list-index prefix from a condition', () => {
    expect(
      check(
        'hedgerows',
        { type: 'Native hedgerow', condition: '2. Moderate' },
        { type: 'Native hedgerow', condition: '3. Good' }
      )
    ).toMatchObject({ rule: ENHANCEMENT_RULE.LOW_HEDGEROW, valid: true })
  })

  it.each([
    [
      'an unrecognised proposed habitat',
      'hedgerows',
      { type: 'Native hedgerow', condition: 'Moderate' },
      { type: 'Not a hedgerow', condition: 'Good' }
    ],
    [
      'a missing proposed side',
      'watercourses',
      { type: 'Culvert', condition: 'Moderate' },
      undefined
    ],
    [
      'individual trees',
      'trees',
      { broadType: 'Individual trees', type: 'Urban tree', condition: 'Good' },
      { broadType: 'Individual trees', type: 'Urban tree', condition: 'Poor' }
    ]
  ])('returns null for %s', (_, layer, baseline, proposed) => {
    expect(check(layer, baseline, proposed)).toBeNull()
  })
})

describe('enhancementRulesForLayer', () => {
  it('lists the rules each layer can break', () => {
    expect(ENHANCEMENT_RULE_LAYERS).toEqual([
      'habitats',
      'hedgerows',
      'watercourses'
    ])
    expect(enhancementRulesForLayer('hedgerows')).toEqual([
      ENHANCEMENT_RULE.MEDIUM_HEDGEROW,
      ENHANCEMENT_RULE.LOW_HEDGEROW,
      ENHANCEMENT_RULE.VERY_LOW_HEDGEROW
    ])
    expect(enhancementRulesForLayer('trees')).toEqual([])
  })
})
