import { describe, it, expect, vi } from 'vitest'

import * as bngMetricEngine from 'bng-metric-engine'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import {
  makeAreaHabitat,
  makeCreatedAreaHabitat,
  makeDoc,
  makeEnhancedHabitat,
  makeLostHabitat
} from './enrich-post-intervention-units.fixtures.js'

describe('area habitat — Retained', () => {
  it('calculates units from baseline type/condition and post-intervention area', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(typeof hab.units).toBe('number')
    expect(hab.units).toBeGreaterThan(0)
    expect(hab.status).toBe('Complete')
  })

  it('writes distinctiveness and conditionScore to proposed sub-object', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.habitats[0].proposed
    expect(proposed.distinctiveness).toBeTruthy()
    expect(typeof proposed.distinctivenessScore).toBe('number')
    expect(typeof proposed.conditionScore).toBe('number')
  })

  it('also enriches baseline sub-object', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const baseline = doc.habitats[0].baseline
    expect(baseline.distinctiveness).toBeTruthy()
    expect(typeof baseline.distinctivenessScore).toBe('number')
    expect(typeof baseline.conditionScore).toBe('number')
  })

  it('does not write distinctiveness fields to the top-level feature', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(hab).not.toHaveProperty('distinctiveness')
    expect(hab).not.toHaveProperty('distinctivenessScore')
    expect(hab).not.toHaveProperty('conditionScore')
  })

  it('marks Incomplete and warns when baseline condition is missing', () => {
    const base = makeAreaHabitat()
    const doc = makeDoc({
      habitats: [{ ...base, baseline: { ...base.baseline, condition: null } }]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(doc.habitats[0].units).toBeNull()
  })

  it('marks Incomplete and warns when baseline type is unrecognised', () => {
    const base = makeAreaHabitat()
    const doc = makeDoc({
      habitats: [
        {
          ...base,
          baseline: {
            ...base.baseline,
            type: 'Not a real habitat',
            broadType: 'Unknown'
          }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('marks the feature Incomplete when the retained area habitat engine throws an unexpected error', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat()] })
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      bngMetricEngine,
      'calculateRetainedAreaHabitatPostIntervention'
    ).mockImplementationOnce(() => {
      throw unexpected
    })
    const logger = { warn: vi.fn() }

    expect(() =>
      enrichPostInterventionDocumentWithUnits(doc, logger)
    ).not.toThrow()
    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('engine unavailable')
    )
  })
})

describe('area habitat — GPKG Lost mapped to Created', () => {
  it('calculates units using proposed type/condition with time and difficulty multipliers', () => {
    const doc = makeDoc({ habitats: [makeLostHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(typeof hab.units).toBe('number')
    expect(hab.units).toBeGreaterThan(0)
    expect(hab.status).toBe('Complete')
  })

  it('writes timeMultiplier and difficultyMultiplier to proposed sub-object', () => {
    const doc = makeDoc({ habitats: [makeLostHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.habitats[0].proposed
    expect(typeof proposed.timeMultiplier).toBe('number')
    expect(typeof proposed.difficultyMultiplier).toBe('number')
  })

  it('calculates units (Complete) when advance/delay years are N/A (null)', () => {
    const base = makeLostHabitat()
    const doc = makeDoc({
      habitats: [
        {
          ...base,
          proposed: { ...base.proposed, advanceYears: null, delayYears: null }
        }
      ]
    })

    expect(() => enrichPostInterventionDocumentWithUnits(doc)).not.toThrow()
    const hab = doc.habitats[0]
    expect(hab.status).toBe('Complete')
    expect(typeof hab.units).toBe('number')
  })

  it('marks Incomplete when proposed condition is missing', () => {
    const base = makeLostHabitat()
    const doc = makeDoc({
      habitats: [{ ...base, proposed: { ...base.proposed, condition: null } }]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('skipped proposed enrichment')
    )
  })
})

describe('area habitat — Created', () => {
  it('calculates units using proposed type/condition with time and difficulty multipliers', () => {
    const doc = makeDoc({ habitats: [makeCreatedAreaHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(typeof hab.units).toBe('number')
    expect(hab.units).toBeGreaterThan(0)
    expect(hab.status).toBe('Complete')
  })

  it('writes statutory time/difficulty and derived display fields to proposed', () => {
    const doc = makeDoc({ habitats: [makeCreatedAreaHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.habitats[0].proposed
    expect(typeof proposed.standardTimeToTargetCondition).toBe('string')
    expect(proposed.standardTimeToTargetCondition.length).toBeGreaterThan(0)
    expect(typeof proposed.difficulty).toBe('string')
    expect(proposed.difficulty.length).toBeGreaterThan(0)
    expect(typeof proposed.advanceOrDelay).toBe('string')
    expect(proposed.advanceOrDelay.length).toBeGreaterThan(0)
    expect(typeof proposed.finalTimeToTargetCondition).toBe('string')
    expect(proposed.finalTimeToTargetCondition.length).toBeGreaterThan(0)
  })
})

describe('area habitat — Enhanced', () => {
  it('calculates units using both baseline and proposed habitat types', () => {
    const doc = makeDoc({ habitats: [makeEnhancedHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(typeof hab.units).toBe('number')
    expect(hab.units).toBeGreaterThan(0)
    expect(hab.status).toBe('Complete')
  })

  it('writes postIntervention distinctiveness fields to proposed sub-object', () => {
    const doc = makeDoc({ habitats: [makeEnhancedHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.habitats[0].proposed
    expect(proposed.distinctiveness).toBeTruthy()
    expect(typeof proposed.distinctivenessScore).toBe('number')
    expect(typeof proposed.conditionScore).toBe('number')
    expect(typeof proposed.timeMultiplier).toBe('number')
    expect(typeof proposed.difficultyMultiplier).toBe('number')
    expect(typeof proposed.standardTimeToTargetCondition).toBe('string')
    expect(proposed.standardTimeToTargetCondition.length).toBeGreaterThan(0)
    expect(typeof proposed.difficulty).toBe('string')
    expect(proposed.difficulty.length).toBeGreaterThan(0)
    expect(typeof proposed.advanceOrDelay).toBe('string')
    expect(proposed.advanceOrDelay.length).toBeGreaterThan(0)
    expect(typeof proposed.finalTimeToTargetCondition).toBe('string')
    expect(proposed.finalTimeToTargetCondition.length).toBeGreaterThan(0)
  })

  it('marks Incomplete when proposed condition is missing', () => {
    const base = makeEnhancedHabitat()
    const doc = makeDoc({
      habitats: [{ ...base, proposed: { ...base.proposed, condition: null } }]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.habitats[0].status).toBe('Incomplete')
  })

  it('marks the feature Incomplete when the enhanced area habitat engine throws an unexpected error', () => {
    const doc = makeDoc({ habitats: [makeEnhancedHabitat()] })
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      bngMetricEngine,
      'calculateEnhancedAreaHabitatPostIntervention'
    ).mockImplementationOnce(() => {
      throw unexpected
    })
    const logger = { warn: vi.fn() }

    expect(() =>
      enrichPostInterventionDocumentWithUnits(doc, logger)
    ).not.toThrow()
    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('engine unavailable')
    )
  })

  it('marks Incomplete when all habitat type candidates fail lookup', () => {
    const base = makeEnhancedHabitat()
    const doc = makeDoc({
      habitats: [
        {
          ...base,
          baseline: {
            ...base.baseline,
            type: 'Not a real habitat',
            broadType: 'Unknown'
          },
          proposed: {
            ...base.proposed,
            type: 'Also not real',
            broadType: 'Unknown'
          }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('area habitat — unknown retention category', () => {
  it('skips proposed enrichment and leaves status Incomplete for null category', () => {
    const base = makeAreaHabitat()
    const doc = makeDoc({
      habitats: [
        {
          ...base,
          retentionCategory: null
        }
      ]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(doc.habitats[0].units).toBeNull()
  })

  it('skips proposed enrichment for an unrecognised category string', () => {
    const base = makeAreaHabitat()
    const doc = makeDoc({
      habitats: [
        {
          ...base,
          retentionCategory: undefined,
          baseline: { ...base.baseline, retentionCategory: 'Partial' }
        }
      ]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.habitats[0].units).toBeNull()
    expect(doc.habitats[0].status).toBe('Incomplete')
  })
})

describe('area habitat — invalid size', () => {
  it('skips proposed enrichment when area is missing or not positive', () => {
    const base = makeAreaHabitat({ area: 0, sizeSquareMetres: 0 })
    const doc = makeDoc({ habitats: [base] })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.habitats[0].units).toBeNull()
    expect(doc.habitats[0].status).toBe('Incomplete')
  })

  it('marks Incomplete when import status was Complete but units cannot be calculated', () => {
    const base = makeAreaHabitat({
      status: 'Complete',
      retentionCategory: undefined,
      baseline: { ...makeAreaHabitat().baseline, retentionCategory: 'Partial' }
    })
    const doc = makeDoc({ habitats: [base] })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.habitats[0].units).toBeNull()
    expect(doc.habitats[0].status).toBe('Incomplete')
  })
})

describe('post-intervention upload resilience', () => {
  it('continues enriching remaining features when one feature throws a non-lookup engine error', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat(), makeAreaHabitat()] })
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      bngMetricEngine,
      'calculateRetainedAreaHabitatPostIntervention'
    ).mockImplementationOnce(() => {
      throw unexpected
    })
    const logger = { warn: vi.fn() }

    expect(() =>
      enrichPostInterventionDocumentWithUnits(doc, logger)
    ).not.toThrow()
    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(doc.habitats[1].status).toBe('Complete')
    expect(typeof doc.habitats[1].units).toBe('number')
    expect(doc.units.totalUnits).toBeGreaterThan(0)
  })
})
