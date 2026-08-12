import { afterEach, describe, expect, it, vi } from 'vitest'

import { enrichBaselineDocumentWithUnits } from './enrich-baseline-units.js'

const calculateHedgerowBaselineMock = vi.hoisted(() => vi.fn())
const calculateWatercourseBaselineMock = vi.hoisted(() => vi.fn())
const engineActual = vi.hoisted(() => ({
  calculateHedgerowBaseline: null,
  calculateWatercourseBaseline: null
}))

vi.mock('bng-metric-engine', async (importOriginal) => {
  const actual = await importOriginal()
  engineActual.calculateHedgerowBaseline = actual.calculateHedgerowBaseline
  engineActual.calculateWatercourseBaseline =
    actual.calculateWatercourseBaseline
  calculateHedgerowBaselineMock.mockImplementation(
    actual.calculateHedgerowBaseline
  )
  calculateWatercourseBaselineMock.mockImplementation(
    actual.calculateWatercourseBaseline
  )
  return {
    ...actual,
    calculateHedgerowBaseline: (...args) =>
      calculateHedgerowBaselineMock(...args),
    calculateWatercourseBaseline: (...args) =>
      calculateWatercourseBaselineMock(...args)
  }
})

afterEach(() => {
  calculateHedgerowBaselineMock.mockImplementation(
    engineActual.calculateHedgerowBaseline
  )
  calculateWatercourseBaselineMock.mockImplementation(
    engineActual.calculateWatercourseBaseline
  )
})

describe('enrichBaselineDocumentWithUnits — hedgerows', () => {
  it('enriches hedgerows with units from calculateHedgerowBaseline (sizeMetres → rounded length → km)', () => {
    // 500 m = 0.5 km × 6 (High) × 3 (Good) × 1 = 9 units
    const document = {
      hedgerows: [
        {
          type: 'Species-rich native hedgerow with trees',
          condition: 'Good',
          sizeMetres: 500,
          status: 'Complete'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    const hedgerowLengthMetres = document.hedgerows[0].length
    expect(hedgerowLengthMetres).toBe(500)
    expect(document.hedgerows[0].distinctiveness).toBe('High')
    expect(document.hedgerows[0].distinctivenessScore).toBe(6)
    expect(document.hedgerows[0].conditionScore).toBe(3)
    expect(document.hedgerows[0].units).toBeCloseTo(9)
    expect(document.hedgerows[0].status).toBe('Complete')
    expect(document.units.hedgerowsTotal).toBeCloseTo(9)
  })

  it('rounds a fractional sizeMetres to an integer length for hedgerows', () => {
    const document = {
      hedgerows: [
        {
          type: 'Species-rich native hedgerow with trees',
          condition: 'Good',
          sizeMetres: 500.7
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    const hedgerowLengthMetres = document.hedgerows[0].length
    expect(hedgerowLengthMetres).toBe(501)
    // 501 m = 0.501 km × 6 × 3 × 1 = 9.018
    expect(document.hedgerows[0].units).toBeCloseTo(9.018)
  })

  it('skips hedgerow enrichment when sizeMetres is missing', () => {
    const document = {
      hedgerows: [{ type: 'Native hedgerow', condition: 'Good' }]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.hedgerows[0]).not.toHaveProperty('units')
    expect(document.units.hedgerowsTotal).toBe(0)
  })

  it('skips hedgerow enrichment when type is missing', () => {
    const document = {
      hedgerows: [{ condition: 'Good', sizeMetres: 500 }]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.hedgerows[0]).not.toHaveProperty('units')
  })

  it('skips hedgerow enrichment for unknown hedge type (BaselineLookupError)', () => {
    const logger = { warn: vi.fn() }
    const document = {
      hedgerows: [
        {
          featureId: 'hedge-1',
          type: 'Unknown hedge type',
          condition: 'Good',
          sizeMetres: 500,
          status: 'Complete'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.hedgerows[0]).not.toHaveProperty('units')
    expect(document.hedgerows[0].status).toBe('Incomplete')
    expect(document.units.hedgerowsTotal).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /enrichBaseline: Hedgerow featureId hedge-1 could not be calculated:/
      )
    )
  })

  it('propagates unexpected engine errors from hedgerow enrichment', () => {
    calculateHedgerowBaselineMock.mockImplementation(() => {
      throw new Error('unexpected hedgerow failure')
    })
    expect(() =>
      enrichBaselineDocumentWithUnits({
        hedgerows: [
          { type: 'Native hedgerow', condition: 'Good', sizeMetres: 500 }
        ]
      })
    ).toThrow('unexpected hedgerow failure')
  })

  it('strips a numbered condition prefix for hedgerows before calling the engine', () => {
    const document = {
      hedgerows: [
        { type: 'Native hedgerow', condition: '3. Good', sizeMetres: 500 }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.hedgerows[0]).toHaveProperty('units')
    expect(calculateHedgerowBaselineMock).toHaveBeenCalledWith(
      expect.any(Number),
      'Native hedgerow',
      'Good'
    )
  })
})

describe('enrichBaselineDocumentWithUnits — watercourses', () => {
  it('enriches watercourses with units from calculateWatercourseBaseline (sizeMetres → rounded length → km)', () => {
    // 1000 m = 1 km × 8 (V.High) × 3 (Good) × 1 × 1 × 1 = 24 units
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    const watercourseLengthMetres = document.watercourses[0].length
    expect(watercourseLengthMetres).toBe(1000)
    expect(document.watercourses[0].distinctiveness).toBe('V.High')
    expect(document.watercourses[0].conditionScore).toBe(3)
    expect(document.watercourses[0].waterEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].riparianEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].units).toBeCloseTo(24)
    expect(document.units.watercoursesTotal).toBeCloseTo(24)
  })

  it('rounds a fractional sizeMetres to an integer length for watercourses', () => {
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000.4
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    const watercourseLengthMetres = document.watercourses[0].length
    expect(watercourseLengthMetres).toBe(1000)
    // 1000 m = 1 km × 8 × 3 × 1 = 24 units (rounding down)
    expect(document.watercourses[0].units).toBeCloseTo(24)
  })

  it('applies encroachment multipliers when present on the watercourse record', () => {
    // 1000 m = 1 km × 8 (V.High) × 3 (Good) × 0.8 (2. Minor) × 0.98 (3. Minor/ No Encroachment) × 1 = 18.816
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000,
          watercourseEncroachment: '2. Minor',
          riparianEncroachment: '3. Minor/ No Encroachment'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.watercourses[0].waterEncroachmentMultiplier).toBe(0.8)
    expect(document.watercourses[0].riparianEncroachmentMultiplier).toBe(0.98)
    expect(document.watercourses[0].units).toBeCloseTo(18.816)
  })

  it('skips watercourse enrichment when sizeMetres is missing', () => {
    const document = {
      watercourses: [{ type: 'Ditches', condition: 'Good' }]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.watercourses[0]).not.toHaveProperty('units')
    expect(document.units.watercoursesTotal).toBe(0)
  })

  it('skips watercourse enrichment when type is missing', () => {
    const document = {
      watercourses: [{ condition: 'Good', sizeMetres: 1000 }]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.watercourses[0]).not.toHaveProperty('units')
  })

  it('skips watercourse enrichment for unknown watercourse type (BaselineLookupError)', () => {
    const logger = { warn: vi.fn() }
    const document = {
      watercourses: [
        {
          featureId: 'wc-1',
          type: 'Unknown watercourse type',
          condition: 'Good',
          sizeMetres: 1000,
          status: 'Complete'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.watercourses[0]).not.toHaveProperty('units')
    expect(document.watercourses[0].status).toBe('Incomplete')
    expect(document.units.watercoursesTotal).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /enrichBaseline: Watercourse featureId wc-1 could not be calculated:/
      )
    )
  })

  it('propagates unexpected engine errors from watercourse enrichment', () => {
    calculateWatercourseBaselineMock.mockImplementation(() => {
      throw new Error('unexpected watercourse failure')
    })
    expect(() =>
      enrichBaselineDocumentWithUnits({
        watercourses: [
          { type: 'Priority habitat', condition: 'Good', sizeMetres: 1000 }
        ]
      })
    ).toThrow('unexpected watercourse failure')
  })
})

describe('enrichBaselineDocumentWithUnits — watercourse encroachment coercion', () => {
  it('silently defaults unrecognised encroachment when no logger is provided', () => {
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000,
          watercourseEncroachment: 'Unrecognised'
        }
      ]
    }
    expect(() => enrichBaselineDocumentWithUnits(document)).not.toThrow()
    expect(document.watercourses[0].waterEncroachmentMultiplier).toBe(1)
  })

  it('defaults unrecognised watercourse encroachment to multiplier 1 and logs a warning', () => {
    const logger = { warn: vi.fn() }
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000,
          watercourseEncroachment: 'None',
          riparianEncroachment: 'No Encroachment/No Encroachment'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.watercourses[0].waterEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].riparianEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].units).toBeCloseTo(24)
    expect(logger.warn).toHaveBeenCalledWith(
      'enrichBaseline: unrecognised watercourse encroachment "None" — defaulting encroachment multiplier to 1'
    )
    expect(calculateWatercourseBaselineMock).toHaveBeenCalledWith(
      1,
      'Priority habitat',
      'Good',
      null,
      'No Encroachment/No Encroachment'
    )
  })

  it('defaults unrecognised riparian encroachment to multiplier 1 and logs a warning', () => {
    const logger = { warn: vi.fn() }
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000,
          watercourseEncroachment: 'No Encroachment',
          riparianEncroachment: 'Low'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.watercourses[0].waterEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].riparianEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].units).toBeCloseTo(24)
    expect(logger.warn).toHaveBeenCalledWith(
      'enrichBaseline: unrecognised riparian encroachment "Low" — defaulting encroachment multiplier to 1'
    )
    expect(calculateWatercourseBaselineMock).toHaveBeenCalledWith(
      1,
      'Priority habitat',
      'Good',
      'No Encroachment',
      null
    )
  })

  it('defaults object encroachment values to multiplier 1 and logs the JSON-stringified value', () => {
    const logger = { warn: vi.fn() }
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000,
          watercourseEncroachment: { custom: 'value' },
          riparianEncroachment: 'No Encroachment/No Encroachment'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.watercourses[0].waterEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].units).toBeCloseTo(24)
    expect(logger.warn).toHaveBeenCalledWith(
      'enrichBaseline: unrecognised watercourse encroachment "{"custom":"value"}" — defaulting encroachment multiplier to 1'
    )
  })

  it('defaults non-string encroachment values to multiplier 1 and logs a warning', () => {
    const logger = { warn: vi.fn() }
    const document = {
      watercourses: [
        {
          type: 'Priority habitat',
          condition: 'Good',
          sizeMetres: 1000,
          watercourseEncroachment: 42,
          riparianEncroachment: 'No Encroachment/No Encroachment'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.watercourses[0].waterEncroachmentMultiplier).toBe(1)
    expect(document.watercourses[0].units).toBeCloseTo(24)
    expect(logger.warn).toHaveBeenCalledWith(
      'enrichBaseline: unrecognised watercourse encroachment "42" — defaulting encroachment multiplier to 1'
    )
    expect(calculateWatercourseBaselineMock).toHaveBeenCalledWith(
      1,
      'Priority habitat',
      'Good',
      null,
      'No Encroachment/No Encroachment'
    )
  })
})
