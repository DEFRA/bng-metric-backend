import { describe, test, expect } from 'vitest'

import { findFeature } from './find-feature.js'

const HABITAT_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
const HEDGEROW_ID = 'bb0e8400-e29b-41d4-a716-446655440002'
const WATERCOURSE_ID = 'cc0e8400-e29b-41d4-a716-446655440003'
const UNKNOWN_ID = 'dd0e8400-e29b-41d4-a716-446655440099'

const sampleHabitat = { featureId: HABITAT_ID, ref: '1' }
const sampleHedgerow = { featureId: HEDGEROW_ID, ref: 'H1' }
const sampleWatercourse = { featureId: WATERCOURSE_ID, ref: 'W1' }

const baseline = {
  habitats: [sampleHabitat],
  hedgerows: [sampleHedgerow],
  watercourses: [sampleWatercourse]
}

describe('findFeature', () => {
  test('returns the habitat with type "habitat" and layer key "habitats"', () => {
    expect(findFeature(baseline, HABITAT_ID)).toEqual({
      type: 'habitat',
      key: 'habitats',
      feature: sampleHabitat
    })
  })

  test('returns the hedgerow with type "hedgerow" and layer key "hedgerows"', () => {
    expect(findFeature(baseline, HEDGEROW_ID)).toEqual({
      type: 'hedgerow',
      key: 'hedgerows',
      feature: sampleHedgerow
    })
  })

  test('returns the watercourse with type "watercourse" and layer key "watercourses"', () => {
    expect(findFeature(baseline, WATERCOURSE_ID)).toEqual({
      type: 'watercourse',
      key: 'watercourses',
      feature: sampleWatercourse
    })
  })

  test('returns null when the featureId is absent from every layer', () => {
    expect(findFeature(baseline, UNKNOWN_ID)).toBeNull()
  })

  test('returns null when the baseline is missing', () => {
    expect(findFeature(null, HABITAT_ID)).toBeNull()
    expect(findFeature(undefined, HABITAT_ID)).toBeNull()
  })

  test('tolerates missing layer arrays', () => {
    const partial = { habitats: [sampleHabitat] }
    expect(findFeature(partial, HEDGEROW_ID)).toBeNull()
    expect(findFeature(partial, HABITAT_ID)).toMatchObject({
      type: 'habitat',
      feature: sampleHabitat
    })
  })

  test('throws when the same featureId appears in multiple layers', () => {
    const collision = {
      habitats: [{ featureId: HABITAT_ID, ref: '1' }],
      hedgerows: [{ featureId: HABITAT_ID, ref: 'H1' }]
    }
    expect(() => findFeature(collision, HABITAT_ID)).toThrow(
      /appears in multiple layers/
    )
  })
})
