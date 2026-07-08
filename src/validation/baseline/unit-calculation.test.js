import { describe, test, expect } from 'vitest'
import {
  HABITAT_STATUS,
  recomputeAreaHabitat,
  recomputeHedgerow,
  recomputeWatercourse
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

  test('V.Low hedgerow uses the hedgerow scores table (score 1, not the area table value of 0)', () => {
    // Non-native and ornamental hedgerow is the V.Low entry in the engine's
    // hedgerow categories. The hedgerow distinctiveness table scores V.Low at
    // 1, whereas the area table scores it at 0 — this asserts we read the
    // right table on the Incomplete path.
    const result = recomputeHedgerow({
      habitatType: 'Non-native and ornamental hedgerow',
      condition: null,
      sizeMetres: 1000
    })
    expect(result).toMatchObject({
      distinctiveness: 'V.Low',
      distinctivenessScore: 1,
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

describe('recomputeWatercourse', () => {
  // Uses real bng-metric-engine data (BMD-597). "Other rivers and streams" is
  // High (6); "Culvert" is Low (2). Units require all four dropdowns plus a
  // positive length.

  test('Complete + computed units when all inputs are valid', () => {
    // 1000 m = 1 km; High (6) × Moderate (2) × 1 km × 0.8 × 0.95 × 1 SS = 9.12
    const result = recomputeWatercourse({
      habitatType: 'Other rivers and streams',
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
      sizeMetres: 1000
    })
    expect(result).toEqual({
      distinctiveness: 'High',
      distinctivenessScore: 6,
      conditionScore: 2,
      units: 9.12,
      status: HABITAT_STATUS.COMPLETE,
      waterEncroachmentMultiplier: 0.8,
      riparianEncroachmentMultiplier: 0.95
    })
  })

  test('Complete for a culvert using the "N/A - Culvert" encroachment values', () => {
    // High-street culvert: Low (2) × Poor (1) × 1 km × 0.68 × 1 = 1.36
    const result = recomputeWatercourse({
      habitatType: 'Culvert',
      condition: 'Poor',
      watercourseEncroachment: 'N/A - Culvert',
      riparianEncroachment: 'N/A - Culvert',
      sizeMetres: 1000
    })
    expect(result.status).toBe(HABITAT_STATUS.COMPLETE)
    expect(result.units).toBe(1.36)
    expect(result.distinctiveness).toBe('Low')
  })

  test('Incomplete + 0 units when habitat type is missing', () => {
    const result = recomputeWatercourse({
      habitatType: null,
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
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
    const result = recomputeWatercourse({
      habitatType: 'Unknown type',
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
      sizeMetres: 1000
    })
    expect(result.distinctiveness).toBeNull()
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.units).toBe(0)
  })

  test.each([
    ['condition', { condition: null }],
    ['watercourse encroachment', { watercourseEncroachment: null }],
    ['riparian encroachment', { riparianEncroachment: null }]
  ])(
    'Incomplete but keeps distinctiveness when %s is missing (Scenario B)',
    (_label, override) => {
      const result = recomputeWatercourse({
        habitatType: 'Other rivers and streams',
        condition: 'Moderate',
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/Minor',
        sizeMetres: 1000,
        ...override
      })
      expect(result).toMatchObject({
        distinctiveness: 'High',
        distinctivenessScore: 6,
        conditionScore: null,
        units: 0,
        status: HABITAT_STATUS.INCOMPLETE
      })
    }
  )

  test('Incomplete + 0 units when condition is not permitted for that habitat type', () => {
    const result = recomputeWatercourse({
      habitatType: 'Other rivers and streams',
      condition: 'Not a real condition',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
      sizeMetres: 1000
    })
    expect(result.conditionScore).toBeNull()
    expect(result.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(result.units).toBe(0)
  })

  test('Incomplete when size is missing or zero', () => {
    const noSize = recomputeWatercourse({
      habitatType: 'Other rivers and streams',
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
      sizeMetres: null
    })
    expect(noSize.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(noSize.units).toBe(0)

    const zeroSize = recomputeWatercourse({
      habitatType: 'Other rivers and streams',
      condition: 'Moderate',
      watercourseEncroachment: 'Minor',
      riparianEncroachment: 'Minor/Minor',
      sizeMetres: 0
    })
    expect(zeroSize.status).toBe(HABITAT_STATUS.INCOMPLETE)
    expect(zeroSize.units).toBe(0)
  })
})
