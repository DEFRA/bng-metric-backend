import { describe, test, expect } from 'vitest'
import {
  HABITAT_STATUS,
  recomputeAreaHabitat,
  recomputeHedgerow
} from './unit-calculation.js'

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
      units: 24,
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
      units: 0,
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
    expect(result.units).toBe(0)
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
      units: 0,
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
      units: 0,
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
    expect(result.units).toBe(0)
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
    expect(result.units).toBe(0)
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
    expect(result.units).toBe(0)
  })

  test('converts square metres to hectares for the engine', () => {
    // 2500 m² = 0.25 ha; V.High (8) × Good (3) × 0.25 = 6
    const result = recomputeAreaHabitat({
      broadType: 'Grassland',
      habitatType: 'Lowland meadows',
      condition: 'Good',
      sizeSquareMetres: 2500
    })
    expect(result.units).toBe(6)
    expect(result.status).toBe(HABITAT_STATUS.COMPLETE)
  })
})

describe('recomputeHedgerow', () => {
  // Uses real bng-metric-engine data (BMD-427/428). Native hedgerow is Low (2),
  // valid conditions are Good (3) / Moderate (2) / Poor (1).

  test('Complete + computed units when all inputs are valid', () => {
    // 1000 m = 1 km; Low (2) × Good (3) × 1 km × 1 SS = 6
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: 1000
    })
    expect(result).toEqual({
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      conditionScore: 3,
      units: 6,
      status: HABITAT_STATUS.COMPLETE
    })
  })

  test('converts metres to kilometres', () => {
    // 500 m = 0.5 km; Low (2) × Good (3) × 0.5 = 3
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: 500
    })
    expect(result.units).toBe(3)
    expect(result.status).toBe(HABITAT_STATUS.COMPLETE)
  })

  test('Incomplete + 0 units when habitat type is missing', () => {
    const result = recomputeHedgerow({
      habitatType: null,
      condition: 'Good',
      sizeMetres: 1000
    })
    expect(result).toMatchObject({
      distinctiveness: null,
      distinctivenessScore: null,
      conditionScore: null,
      units: 0,
      status: HABITAT_STATUS.INCOMPLETE
    })
  })

  test('Incomplete + 0 units when habitat type is unknown', () => {
    const result = recomputeHedgerow({
      habitatType: 'Unknown type',
      condition: 'Good',
      sizeMetres: 1000
    })
    expect(result.distinctiveness).toBeNull()
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.units).toBe(0)
  })

  test('Incomplete but keeps distinctiveness when condition is missing', () => {
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: null,
      sizeMetres: 1000
    })
    expect(result).toMatchObject({
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      conditionScore: null,
      units: 0,
      status: HABITAT_STATUS.INCOMPLETE
    })
  })

  test('Incomplete + 0 units when condition is not permitted for that habitat type', () => {
    // Fairly Good is "Not Possible" for Native hedgerow in the engine data.
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Fairly Good',
      sizeMetres: 1000
    })
    expect(result.conditionScore).toBeNull()
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.units).toBe(0)
  })

  test('Incomplete when size is missing or zero', () => {
    const noSize = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: null
    })
    expect(noSize.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(noSize.units).toBe(0)

    const zeroSize = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: 0
    })
    expect(zeroSize.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(zeroSize.units).toBe(0)
  })
})
