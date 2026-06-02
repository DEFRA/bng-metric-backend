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
  // BMD-427/428 will publish hedgerow scoring through bng-metric-engine, at
  // which point recomputeHedgerow can drop these injected references. Until
  // then the function exposes them so the engine-bound logic can be tested
  // ahead of the data landing.
  const references = {
    distinctivenessByType: {
      'Native hedgerow': 'Medium',
      'Line of trees': 'Low'
    },
    conditionScores: {
      'Native hedgerow': {
        Good: 3,
        Moderate: 2,
        Poor: 1,
        'Not Possible': 'Not Possible'
      },
      'Line of trees': { Good: 3, Poor: 1 }
    }
  }

  test('Complete + computed units when all inputs are valid', () => {
    // 1000 m = 1 km; Medium (4) × Good (3) × 1 km × 1 SS = 12
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: 1000,
      references
    })
    expect(result).toEqual({
      distinctiveness: 'Medium',
      distinctivenessScore: 4,
      conditionScore: 3,
      units: 12,
      status: HABITAT_STATUS.COMPLETE
    })
  })

  test('converts metres to kilometres', () => {
    // 500 m = 0.5 km; Low (2) × Good (3) × 0.5 = 3
    const result = recomputeHedgerow({
      habitatType: 'Line of trees',
      condition: 'Good',
      sizeMetres: 500,
      references
    })
    expect(result.units).toBe(3)
    expect(result.status).toBe(HABITAT_STATUS.COMPLETE)
  })

  test('Incomplete + 0 units when habitat type is missing', () => {
    const result = recomputeHedgerow({
      habitatType: null,
      condition: 'Good',
      sizeMetres: 1000,
      references
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
      sizeMetres: 1000,
      references
    })
    expect(result.distinctiveness).toBeNull()
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.units).toBe(0)
  })

  test('Incomplete but keeps distinctiveness when condition is missing', () => {
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: null,
      sizeMetres: 1000,
      references
    })
    expect(result).toMatchObject({
      distinctiveness: 'Medium',
      distinctivenessScore: 4,
      conditionScore: null,
      units: 0,
      status: HABITAT_STATUS.INCOMPLETE
    })
  })

  test('Incomplete + 0 units when condition is not permitted for that habitat type', () => {
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Not Possible',
      sizeMetres: 1000,
      references
    })
    expect(result.conditionScore).toBeNull()
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.units).toBe(0)
  })

  test('Incomplete when size is missing or zero', () => {
    const noSize = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: null,
      references
    })
    expect(noSize.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(noSize.units).toBe(0)

    const zeroSize = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: 0,
      references
    })
    expect(zeroSize.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(zeroSize.units).toBe(0)
  })

  test('defaults to empty reference data when none injected (BMD-427/428 unblocker)', () => {
    // Until the engine ships hedgerow scoring, the production defaults are
    // empty objects, so any save resolves to Incomplete. This locks that
    // behaviour in so the soft-fail does not regress when the engine lands.
    const result = recomputeHedgerow({
      habitatType: 'Native hedgerow',
      condition: 'Good',
      sizeMetres: 1000
    })
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.units).toBe(0)
  })
})
