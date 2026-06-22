import { afterEach, describe, expect, it, vi } from 'vitest'

import { BaselineLookupError } from 'bng-metric-engine'

import {
  enrichBaselineDocumentWithUnits,
  engineHabitatTypeCandidates,
  normalizeConditionForEngine
} from './enrich-baseline-units.js'

const calculateAreaHabitatBaselineMock = vi.hoisted(() => vi.fn())
const calculateHedgerowBaselineMock = vi.hoisted(() => vi.fn())
const calculateWatercourseBaselineMock = vi.hoisted(() => vi.fn())
const engineActual = vi.hoisted(() => ({
  calculateAreaHabitatBaseline: null,
  calculateHedgerowBaseline: null,
  calculateWatercourseBaseline: null
}))

vi.mock('bng-metric-engine', async (importOriginal) => {
  const actual = await importOriginal()
  engineActual.calculateAreaHabitatBaseline =
    actual.calculateAreaHabitatBaseline
  engineActual.calculateHedgerowBaseline = actual.calculateHedgerowBaseline
  engineActual.calculateWatercourseBaseline =
    actual.calculateWatercourseBaseline
  calculateAreaHabitatBaselineMock.mockImplementation(
    actual.calculateAreaHabitatBaseline
  )
  calculateHedgerowBaselineMock.mockImplementation(
    actual.calculateHedgerowBaseline
  )
  calculateWatercourseBaselineMock.mockImplementation(
    actual.calculateWatercourseBaseline
  )
  return {
    ...actual,
    calculateAreaHabitatBaseline: (...args) =>
      calculateAreaHabitatBaselineMock(...args),
    calculateHedgerowBaseline: (...args) =>
      calculateHedgerowBaselineMock(...args),
    calculateWatercourseBaseline: (...args) =>
      calculateWatercourseBaselineMock(...args)
  }
})

afterEach(() => {
  calculateAreaHabitatBaselineMock.mockImplementation(
    engineActual.calculateAreaHabitatBaseline
  )
  calculateHedgerowBaselineMock.mockImplementation(
    engineActual.calculateHedgerowBaseline
  )
  calculateWatercourseBaselineMock.mockImplementation(
    engineActual.calculateWatercourseBaseline
  )
})

describe('normalizeConditionForEngine', () => {
  it('strips leading list index from statutory condition labels', () => {
    expect(normalizeConditionForEngine('6. N/A - Other')).toBe('N/A - Other')
  })

  it('returns trimmed string when there is no index prefix', () => {
    expect(normalizeConditionForEngine('  Moderate  ')).toBe('Moderate')
  })

  it('coerces null to an empty string so engine consumers always get a string', () => {
    expect(normalizeConditionForEngine(null)).toBe('')
  })

  it('coerces undefined to an empty string so engine consumers always get a string', () => {
    expect(normalizeConditionForEngine(undefined)).toBe('')
  })
})

describe('engineHabitatTypeCandidates', () => {
  it('yields broad-prefixed key when type is not already prefixed', () => {
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: 'Developed land; sealed surface',
          broadType: 'Urban'
        })
      )
    ).toEqual([
      'Developed land; sealed surface',
      'Urban - Developed land; sealed surface'
    ])
  })

  it('yields nothing when habitat type is empty after trim', () => {
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: '',
          broadType: 'Urban'
        })
      )
    ).toEqual([])
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: '  \t',
          broadType: 'Urban'
        })
      )
    ).toEqual([])
    expect(
      Array.from(engineHabitatTypeCandidates({ broadType: 'Urban' }))
    ).toEqual([])
    expect(Array.from(engineHabitatTypeCandidates({ type: null }))).toEqual([])
  })

  it('does not duplicate when type already includes broad prefix', () => {
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: 'Urban - Developed land; sealed surface',
          broadType: 'Urban'
        })
      )
    ).toEqual(['Urban - Developed land; sealed surface'])
  })
})

describe('enrichBaselineDocumentWithUnits', () => {
  it('resolves Urban sealed surface from separate broad / type + numbered condition (real GeoPackage shape)', () => {
    const document = {
      habitats: [
        {
          featureId: '978cfa8a-34fe-4a07-856c-fcf032cc0b9d',
          ref: 'H1',
          type: 'Developed land; sealed surface',
          broadType: 'Urban',
          condition: '6. N/A - Other',
          area: 676
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.habitats[0].distinctiveness).toBe('V.Low')
    expect(document.habitats[0].distinctivenessScore).toBe(0)
    expect(document.habitats[0].units).toBe(0)
    expect(document.units).toEqual({
      totalUnits: 0,
      habitatsTotal: 0,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
  })

  it('sets distinctivenessScore, conditionScore and units from calculateAreaHabitatBaseline using area in m²', () => {
    const document = {
      habitats: [
        {
          featureId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          type: 'Grassland - Modified grassland',
          condition: 'Moderate',
          area: 10_000
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.habitats[0].distinctiveness).toBe('Low')
    expect(document.habitats[0].distinctivenessScore).toBe(2)
    expect(document.habitats[0].conditionScore).toBe(2)
    // 1 ha × distinctiveness 2 × condition 2 × strategic significance 1
    expect(document.habitats[0].units).toBe(4)
    expect(document.units).toEqual({
      totalUnits: 4,
      habitatsTotal: 4,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
  })

  it('sums only calculable habitat parcels into units.habitatsTotal', () => {
    const document = {
      habitats: [
        {
          type: 'Grassland - Modified grassland',
          condition: 'Moderate',
          area: 10_000
        },
        {
          type: 'Grassland - Modified grassland',
          area: 10_000
        }
      ],
      hedgerows: [],
      watercourses: []
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.units).toEqual({
      totalUnits: 4,
      habitatsTotal: 4,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
  })

  it('enriches individual trees via the area-habitat calculation and totals them by type', () => {
    const document = {
      habitats: [],
      hedgerows: [],
      watercourses: [],
      trees: [
        {
          featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          type: 'Urban tree',
          broadType: 'Individual trees',
          condition: 'Good',
          area: 163
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    const tree = document.trees[0]
    expect(tree.distinctiveness).toBe('Medium')
    expect(tree.distinctivenessScore).toBe(4)
    expect(tree.conditionScore).toBe(3)
    // 0.0163 ha × distinctiveness 4 × condition 3 × strategic significance 1
    expect(tree.units).toBeCloseTo(0.1956, 4)
    expect(tree.status).toBe('Complete')
    expect(document.units.treesTotal).toBeCloseTo(0.1956, 4)
    expect(document.units.treesUrbanTotal).toBeCloseTo(0.1956, 4)
    expect(document.units.treesRuralTotal).toBe(0)
    expect(document.units.totalUnits).toBeCloseTo(0.1956, 4)
  })

  it('skips enrichment when baseline type, condition, or area is missing', () => {
    const document = {
      habitats: [
        {
          featureId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          type: 'Grassland - Modified grassland',
          area: 10_000
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.habitats[0]).not.toHaveProperty('units')
    expect(document.units.habitatsTotal).toBe(0)
  })

  it('marks a whitespace-only habitat type as Incomplete when no engine labels match', () => {
    const logger = { warn: vi.fn() }
    const document = {
      habitats: [
        {
          featureId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          type: '   ',
          condition: 'Moderate',
          area: 10_000,
          status: 'Complete'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.habitats[0]).not.toHaveProperty('units')
    expect(document.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Habitat type is empty or unrecognised/)
    )
  })

  it('skips when the engine does not recognise the habitat', () => {
    const logger = { warn: vi.fn() }
    const document = {
      habitats: [
        {
          featureId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          type: 'Not a real habitat type ',
          condition: 'Moderate',
          area: 10_000,
          status: 'Complete'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.habitats[0]).not.toHaveProperty('units')
    expect(document.habitats[0].status).toBe('Incomplete')
    expect(document.units.habitatsTotal).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /enrichBaseline: Habitat parcel featureId bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb could not be calculated:/
      )
    )
  })

  it('uses "unknown" as featureId placeholder when the feature has no featureId and the engine rejects it', () => {
    const logger = { warn: vi.fn() }
    const document = {
      habitats: [
        {
          type: 'Not a real habitat type',
          condition: 'Moderate',
          area: 10_000
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document, logger)
    expect(document.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/featureId unknown could not be calculated:/)
    )
  })

  it('propagates unexpected engine errors instead of swallowing them', () => {
    calculateAreaHabitatBaselineMock.mockImplementation(() => {
      throw new Error('unexpected engine failure')
    })

    expect(() =>
      enrichBaselineDocumentWithUnits({
        habitats: [
          {
            type: 'Grassland - Modified grassland',
            condition: 'Moderate',
            area: 10_000
          }
        ]
      })
    ).toThrow('unexpected engine failure')
  })

  it('tries the next habitat label after BaselineLookupError on the first candidate', () => {
    calculateAreaHabitatBaselineMock.mockImplementation(
      (sizeHa, engineType, condition) => {
        if (engineType === 'Developed land; sealed surface') {
          throw new BaselineLookupError(
            "Habitat 'Developed land; sealed surface' is not a valid habitat"
          )
        }
        return {
          units: 0,
          distinctiveness: 'V.Low',
          distinctivenessScore: 0,
          conditionScore: 0,
          strategicSignificanceScore: 1
        }
      }
    )

    const document = {
      habitats: [
        {
          type: 'Developed land; sealed surface',
          broadType: 'Urban',
          condition: 'N/A - Other',
          area: 676
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(calculateAreaHabitatBaselineMock).toHaveBeenCalledTimes(2)
    expect(document.habitats[0].units).toBe(0)
  })

  it('stops after the first successful candidate without calling the engine again', () => {
    const successResult = {
      units: 2,
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      conditionScore: 2,
      strategicSignificanceScore: 1
    }
    calculateAreaHabitatBaselineMock.mockReturnValue(successResult)

    // type does not include the broad prefix, so two candidates are yielded:
    // 1) 'Modified grassland'  2) 'Grassland - Modified grassland'
    // The mock succeeds on the first call, so the break on the second iteration
    // should prevent a second engine call.
    const document = {
      habitats: [
        {
          type: 'Modified grassland',
          broadType: 'Grassland',
          condition: 'Moderate',
          area: 10_000
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(calculateAreaHabitatBaselineMock).toHaveBeenCalledTimes(1)
    expect(document.habitats[0].units).toBe(2)
  })

  it('sets zero units totals when habitats are absent', () => {
    const document = { redLine: null }
    enrichBaselineDocumentWithUnits(document)
    expect(document.units).toEqual({
      totalUnits: 0,
      habitatsTotal: 0,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
    expect(enrichBaselineDocumentWithUnits(document)).toBe(document)
  })

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
    expect(document.hedgerows[0].length).toBe(500)
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
    expect(document.hedgerows[0].length).toBe(501)
    // 501 m = 0.501 km × 6 × 3 × 1 = 9.018
    expect(document.hedgerows[0].units).toBeCloseTo(9.018)
  })

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
    expect(document.watercourses[0].length).toBe(1000)
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
    expect(document.watercourses[0].length).toBe(1000)
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

  it('accumulates totalUnits across habitats, hedgerows, and watercourses', () => {
    const document = {
      habitats: [
        {
          type: 'Grassland - Modified grassland',
          condition: 'Moderate',
          area: 10_000
        }
      ],
      hedgerows: [
        {
          type: 'Native hedgerow with trees',
          condition: 'Good',
          sizeMetres: 1000
        }
      ],
      watercourses: [
        {
          type: 'Ditches',
          condition: 'Moderate',
          sizeMetres: 2000,
          watercourseEncroachment: 'No Encroachment',
          riparianEncroachment: 'No Encroachment/No Encroachment'
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    // habitats: 1 ha × 2 × 2 × 1 = 4
    // hedgerows: 1 km × 4 × 3 × 1 = 12
    // watercourses: 2 km × 4 × 2 × 1 = 16
    expect(document.units.habitatsTotal).toBeCloseTo(4)
    expect(document.units.hedgerowsTotal).toBeCloseTo(12)
    expect(document.units.watercoursesTotal).toBeCloseTo(16)
    expect(document.units.totalUnits).toBeCloseTo(32)
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
