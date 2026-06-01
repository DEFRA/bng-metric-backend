import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.js'
import { calculateAreaHabitatBaseline } from './baseline.js'

const H = 'Grassland - Modified grassland'
const H_VHIGH = 'Grassland - Lowland dry acid grassland'

describe('calculateAreaHabitatBaseline', () => {
  it('returns correct units for a Low distinctiveness habitat in Moderate condition', () => {
    // 1 ha × 2 (Low) × 2 (Moderate) × 1 = 4
    const result = calculateAreaHabitatBaseline(1, H, 'Moderate')
    expect(result.units).toBe(4)
    expect(result.distinctiveness).toBe('Low')
    expect(result.distinctivenessScore).toBe(2)
    expect(result.conditionScore).toBe(2)
    expect(result.strategicSignificanceScore).toBe(1)
  })

  it('returns correct units for a V.High distinctiveness habitat in Good condition', () => {
    // 0.5 ha × 8 (V.High) × 3 (Good) × 1 = 12
    const result = calculateAreaHabitatBaseline(0.5, H_VHIGH, 'Good')
    expect(result.units).toBeCloseTo(12)
    expect(result.distinctiveness).toBe('V.High')
    expect(result.distinctivenessScore).toBe(8)
    expect(result.conditionScore).toBe(3)
  })

  it('scales units linearly with size', () => {
    const r1 = calculateAreaHabitatBaseline(1, H, 'Good')
    const r2 = calculateAreaHabitatBaseline(2, H, 'Good')
    expect(r2.units).toBeCloseTo(r1.units * 2)
  })

  it('throws for zero size', () => {
    expect(() => calculateAreaHabitatBaseline(0, H, 'Good')).toThrow(
      'Size must be a finite number greater than 0'
    )
  })

  it('throws for negative size', () => {
    expect(() => calculateAreaHabitatBaseline(-1, H, 'Good')).toThrow(
      'Size must be a finite number greater than 0'
    )
  })

  it('throws for non-numeric size', () => {
    expect(() => calculateAreaHabitatBaseline('one', H, 'Good')).toThrow(
      'Size must be a finite number greater than 0'
    )
  })

  it('throws for an unrecognised habitat type', () => {
    expect(() =>
      calculateAreaHabitatBaseline(1, 'Not a valid habitat', 'Good')
    ).toThrow()
  })

  it('throws BaselineLookupError for a Not Possible condition', () => {
    expect(() =>
      calculateAreaHabitatBaseline(1, H, 'Condition Assessment N/A')
    ).toThrow(BaselineLookupError)
  })
})
