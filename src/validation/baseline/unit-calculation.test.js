import { describe, test, expect } from 'vitest'
import {
  HABITAT_STATUS,
  computeHabitatUnits,
  recomputeAreaHabitat,
  resolveDistinctiveness
} from './unit-calculation.js'

describe('resolveDistinctiveness', () => {
  test('returns band + score for a known pair', () => {
    expect(resolveDistinctiveness('Grassland', 'Lowland meadows')).toEqual({
      distinctiveness: 'V.High',
      score: 8
    })
  })

  test('returns null when either value is missing', () => {
    expect(resolveDistinctiveness(null, 'Lowland meadows')).toBeNull()
    expect(resolveDistinctiveness('Grassland', null)).toBeNull()
  })

  test('returns null for an unknown pair', () => {
    expect(resolveDistinctiveness('Grassland', 'Wrong type')).toBeNull()
  })
})

describe('computeHabitatUnits', () => {
  test('multiplies hectares × distinctiveness × condition with MVS defaults', () => {
    // 1 hectare × distinctiveness 4 × condition 2 × 1 × 1 = 8
    expect(
      computeHabitatUnits({
        sizeSquareMetres: 10_000,
        distinctivenessScore: 4,
        conditionScore: 2
      })
    ).toBe(8)
  })

  test('converts square metres into hectares correctly', () => {
    // 2,500 m² = 0.25 ha; × 8 × 3 = 6
    expect(
      computeHabitatUnits({
        sizeSquareMetres: 2500,
        distinctivenessScore: 8,
        conditionScore: 3
      })
    ).toBe(6)
  })

  test('returns 0 when sizeSquareMetres is missing or non-positive', () => {
    expect(
      computeHabitatUnits({
        sizeSquareMetres: null,
        distinctivenessScore: 4,
        conditionScore: 2
      })
    ).toBe(0)
    expect(
      computeHabitatUnits({
        sizeSquareMetres: 0,
        distinctivenessScore: 4,
        conditionScore: 2
      })
    ).toBe(0)
    expect(
      computeHabitatUnits({
        sizeSquareMetres: -100,
        distinctivenessScore: 4,
        conditionScore: 2
      })
    ).toBe(0)
  })

  test('returns 0 when distinctiveness or condition score is missing', () => {
    expect(
      computeHabitatUnits({
        sizeSquareMetres: 10_000,
        distinctivenessScore: null,
        conditionScore: 2
      })
    ).toBe(0)
    expect(
      computeHabitatUnits({
        sizeSquareMetres: 10_000,
        distinctivenessScore: 4,
        conditionScore: null
      })
    ).toBe(0)
  })

  test('honours explicit strategic significance and spatial risk overrides', () => {
    // 1 ha × 4 × 2 × 1.15 × 0.5 = 4.6
    expect(
      computeHabitatUnits({
        sizeSquareMetres: 10_000,
        distinctivenessScore: 4,
        conditionScore: 2,
        strategicSignificance: 1.15,
        spatialRisk: 0.5
      })
    ).toBeCloseTo(4.6, 10)
  })
})

describe('recomputeAreaHabitat', () => {
  test('returns Complete + computed units when all inputs are valid', () => {
    const result = recomputeAreaHabitat({
      broadType: 'Grassland',
      habitatType: 'Lowland meadows',
      condition: 'Good',
      sizeSquareMetres: 10_000
    })
    expect(result).toEqual({
      distinctiveness: 'V.High',
      distinctivenessScore: 8,
      conditionScore: 3,
      // 1 ha × 8 × 3 × 1 × 1 = 24
      habitatUnits: 24,
      status: HABITAT_STATUS.COMPLETE
    })
  })

  test('Incomplete + 0 units when broad habitat is missing', () => {
    const result = recomputeAreaHabitat({
      broadType: null,
      habitatType: 'Lowland meadows',
      condition: 'Good',
      sizeSquareMetres: 10_000
    })
    expect(result).toMatchObject({
      distinctiveness: null,
      distinctivenessScore: null,
      conditionScore: null,
      habitatUnits: 0,
      status: HABITAT_STATUS.INCOMPLETE
    })
  })

  test('Incomplete + 0 units when habitat type is missing', () => {
    const result = recomputeAreaHabitat({
      broadType: 'Grassland',
      habitatType: null,
      condition: 'Good',
      sizeSquareMetres: 10_000
    })
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.habitatUnits).toBe(0)
  })

  test('Incomplete + 0 units when condition is missing', () => {
    const result = recomputeAreaHabitat({
      broadType: 'Grassland',
      habitatType: 'Lowland meadows',
      condition: null,
      sizeSquareMetres: 10_000
    })
    expect(result).toMatchObject({
      distinctiveness: 'V.High',
      distinctivenessScore: 8,
      conditionScore: null,
      habitatUnits: 0,
      status: HABITAT_STATUS.INCOMPLETE
    })
  })

  test('Incomplete + 0 units when condition is not permitted for that habitat type', () => {
    // Cropland - Cereal crops only permits "Condition Assessment N/A"
    const result = recomputeAreaHabitat({
      broadType: 'Cropland',
      habitatType: 'Cereal crops',
      condition: 'Good',
      sizeSquareMetres: 10_000
    })
    expect(result.conditionScore).toBeNull()
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.habitatUnits).toBe(0)
  })

  test('Complete + 0 units when condition score is legitimately zero', () => {
    // Sealed-surface habitat: only N/A - Other (score 0) is permitted
    const result = recomputeAreaHabitat({
      broadType: 'Urban',
      habitatType: 'Developed land; sealed surface',
      condition: 'N/A - Other',
      sizeSquareMetres: 10_000
    })
    expect(result.conditionScore).toBe(0)
    expect(result.habitatUnits).toBe(0)
    expect(result.status).toBe(HABITAT_STATUS.COMPLETE)
  })

  test('Incomplete when size is missing', () => {
    const result = recomputeAreaHabitat({
      broadType: 'Grassland',
      habitatType: 'Lowland meadows',
      condition: 'Good',
      sizeSquareMetres: null
    })
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.habitatUnits).toBe(0)
  })
})
