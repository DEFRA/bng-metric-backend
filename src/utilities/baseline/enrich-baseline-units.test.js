import { afterEach, describe, expect, it, vi } from 'vitest'

import { BaselineLookupError } from 'bng-metric-engine'

import {
  enrichBaselineDocumentWithUnits,
  engineHabitatTypeCandidates,
  normalizeConditionForEngine,
  sumFeatureBaselineUnits,
  summarizeBaselineUnitsTotals
} from './enrich-baseline-units.js'

const calculateAreaHabitatBaselineMock = vi.hoisted(() => vi.fn())
const engineActual = vi.hoisted(() => ({
  calculateAreaHabitatBaseline: null
}))

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

describe('normalizeConditionForEngine', () => {
  it('strips leading list index from statutory condition labels', () => {
    expect(normalizeConditionForEngine('6. N/A - Other')).toBe('N/A - Other')
  })

  it('returns trimmed string when there is no index prefix', () => {
    expect(normalizeConditionForEngine('  Moderate  ')).toBe('Moderate')
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

describe('sumFeatureBaselineUnits', () => {
  it('sums only finite numeric units on features', () => {
    expect(
      sumFeatureBaselineUnits([
        { units: 4 },
        { units: 1.5 },
        { units: null },
        {},
        { units: Number.NaN }
      ])
    ).toBe(5.5)
  })

  it('returns 0 for missing or empty arrays', () => {
    expect(sumFeatureBaselineUnits(undefined)).toBe(0)
    expect(sumFeatureBaselineUnits([])).toBe(0)
  })
})

describe('summarizeBaselineUnitsTotals', () => {
  it('sums units per layer and sets totalUnits to their combined total', () => {
    const document = {
      habitats: [{ units: 3 }, { units: 1 }],
      hedgerows: [{ units: 99 }],
      watercourses: []
    }
    summarizeBaselineUnitsTotals(document)
    expect(document.units).toEqual({
      totalUnits: 103,
      habitatsTotal: 4,
      hedgerowsTotal: 99,
      watercoursesTotal: 0
    })
  })

  it('emits zero totals when no features have units', () => {
    const document = {
      habitats: [{ ref: 'H1' }],
      hedgerows: [],
      watercourses: []
    }
    summarizeBaselineUnitsTotals(document)
    expect(document.units).toEqual({
      totalUnits: 0,
      habitatsTotal: 0,
      hedgerowsTotal: 0,
      watercoursesTotal: 0
    })
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
      watercoursesTotal: 0
    })
  })

  it('sets distinctivenessScore and units from calculateAreaHabitatBaseline using area in m²', () => {
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
    // 1 ha × distinctiveness 2 × condition 2 × strategic significance 1
    expect(document.habitats[0].units).toBe(4)
    expect(document.units).toEqual({
      totalUnits: 4,
      habitatsTotal: 4,
      hedgerowsTotal: 0,
      watercoursesTotal: 0
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
      watercoursesTotal: 0
    })
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

  it('skips when the engine does not recognise the habitat', () => {
    const document = {
      habitats: [
        {
          featureId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          type: 'Not a real habitat type ',
          condition: 'Moderate',
          area: 10_000
        }
      ]
    }
    enrichBaselineDocumentWithUnits(document)
    expect(document.habitats[0]).not.toHaveProperty('units')
    expect(document.units.habitatsTotal).toBe(0)
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
      watercoursesTotal: 0
    })
    expect(enrichBaselineDocumentWithUnits(document)).toBe(document)
  })
})
