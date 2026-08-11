import { afterEach, describe, expect, it, vi } from 'vitest'

import { BaselineLookupError } from 'bng-metric-engine'

import { enrichBaselineDocumentWithUnits } from './enrich-baseline-units.js'

const calculateAreaHabitatBaselineMock = vi.hoisted(() => vi.fn())
const engineActual = vi.hoisted(() => ({ calculateAreaHabitatBaseline: null }))

vi.mock('bng-metric-engine', async (importOriginal) => {
  const actual = await importOriginal()
  engineActual.calculateAreaHabitatBaseline =
    actual.calculateAreaHabitatBaseline
  calculateAreaHabitatBaselineMock.mockImplementation(
    actual.calculateAreaHabitatBaseline
  )
  return {
    ...actual,
    calculateAreaHabitatBaseline: (...args) =>
      calculateAreaHabitatBaselineMock(...args)
  }
})

afterEach(() => {
  calculateAreaHabitatBaselineMock.mockImplementation(
    engineActual.calculateAreaHabitatBaseline
  )
})

describe('enrichBaselineDocumentWithUnits — area habitats and trees', () => {
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
})
