import { describe, test, expect } from 'vitest'
import { getConditionScore } from './habitat-condition.js'

describe('getConditionScore', () => {
  test('returns the numeric score for a standard 1-3 habitat', () => {
    expect(getConditionScore('Grassland - Lowland meadows', 'Good')).toBe(3)
    expect(
      getConditionScore('Grassland - Lowland meadows', 'Fairly Good')
    ).toBe(2.5)
    expect(getConditionScore('Grassland - Lowland meadows', 'Moderate')).toBe(2)
    expect(
      getConditionScore('Grassland - Lowland meadows', 'Fairly Poor')
    ).toBe(1.5)
    expect(getConditionScore('Grassland - Lowland meadows', 'Poor')).toBe(1)
  })

  test('returns 1 for the only permitted N/A on a "condition N/A" habitat', () => {
    expect(
      getConditionScore('Cropland - Cereal crops', 'Condition Assessment N/A')
    ).toBe(1)
  })

  test('returns null for a disallowed condition on a "condition N/A" habitat', () => {
    expect(getConditionScore('Cropland - Cereal crops', 'Good')).toBeNull()
    expect(
      getConditionScore('Cropland - Cereal crops', 'N/A - Other')
    ).toBeNull()
  })

  test('returns 0 for the only permitted N/A on a sealed-surface habitat', () => {
    expect(
      getConditionScore('Urban - Developed land; sealed surface', 'N/A - Other')
    ).toBe(0)
  })

  test('returns null for a disallowed condition on a sealed-surface habitat', () => {
    expect(
      getConditionScore('Urban - Developed land; sealed surface', 'Good')
    ).toBeNull()
    expect(
      getConditionScore(
        'Urban - Developed land; sealed surface',
        'Condition Assessment N/A'
      )
    ).toBeNull()
  })

  test('returns 3 for "Good" on Felled woodland and null for other conditions', () => {
    expect(getConditionScore('Woodland and forest - Felled', 'Good')).toBe(3)
    expect(
      getConditionScore('Woodland and forest - Felled', 'Fairly Good')
    ).toBeNull()
    expect(getConditionScore('Woodland and forest - Felled', 'Poor')).toBeNull()
  })

  test('returns null for unknown habitat type', () => {
    expect(getConditionScore('Made-up habitat', 'Good')).toBeNull()
  })

  test('returns null for nullish inputs', () => {
    expect(getConditionScore(null, 'Good')).toBeNull()
    expect(getConditionScore('Grassland - Lowland meadows', null)).toBeNull()
    expect(getConditionScore(undefined, undefined)).toBeNull()
    expect(getConditionScore('', '')).toBeNull()
  })
})
