import { describe, test, expect } from 'vitest'
import { HABITAT_STATUS, recomputeAreaHabitat } from './unit-calculation.js'

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
      // 1 ha × 8 × 3 × 1 = 24
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

  test('Incomplete + 0 units when broad/habitat-type pair is unknown', () => {
    const result = recomputeAreaHabitat({
      broadType: 'Grassland',
      habitatType: 'Wrong type',
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

  test('Incomplete + 0 units when condition is missing — but keeps distinctiveness', () => {
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

  test('converts square metres to hectares for the engine', () => {
    // 2500 m² = 0.25 ha; V.High (8) × Good (3) × 0.25 = 6
    const result = recomputeAreaHabitat({
      broadType: 'Grassland',
      habitatType: 'Lowland meadows',
      condition: 'Good',
      sizeSquareMetres: 2500
    })
    expect(result.habitatUnits).toBe(6)
    expect(result.status).toBe(HABITAT_STATUS.COMPLETE)
  })
})
