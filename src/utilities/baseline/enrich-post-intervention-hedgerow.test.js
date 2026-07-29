import { describe, it, expect, vi } from 'vitest'

import * as bngMetricEngine from 'bng-metric-engine'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import {
  makeCreatedHedgerow,
  makeDoc,
  makeEnhancedHedgerow,
  makeHedgerow,
  makeLostHedgerow
} from './enrich-post-intervention-units.fixtures.js'

describe('hedgerow — Retained', () => {
  it('calculates units from baseline type/condition and post-intervention length', () => {
    const doc = makeDoc({ hedgerows: [makeHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const hedge = doc.hedgerows[0]
    expect(typeof hedge.units).toBe('number')
    expect(hedge.units).toBeGreaterThan(0)
    expect(hedge.status).toBe('Complete')
  })

  it('writes distinctiveness/conditionScore to proposed sub-object', () => {
    const doc = makeDoc({ hedgerows: [makeHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.hedgerows[0].proposed
    expect(proposed.distinctiveness).toBeTruthy()
    expect(typeof proposed.distinctivenessScore).toBe('number')
    expect(typeof proposed.conditionScore).toBe('number')
  })

  it('also enriches baseline sub-object', () => {
    const doc = makeDoc({ hedgerows: [makeHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const baseline = doc.hedgerows[0].baseline
    expect(baseline.distinctiveness).toBeTruthy()
    expect(typeof baseline.conditionScore).toBe('number')
  })

  it('does not write distinctiveness to the top-level feature', () => {
    const doc = makeDoc({ hedgerows: [makeHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.hedgerows[0]).not.toHaveProperty('distinctiveness')
  })

  it('marks Incomplete when baseline condition is missing', () => {
    const base = makeHedgerow()
    const doc = makeDoc({
      hedgerows: [{ ...base, baseline: { ...base.baseline, condition: null } }]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.hedgerows[0].status).toBe('Incomplete')
  })

  it('marks Incomplete and warns when baseline type is unrecognised', () => {
    const base = makeHedgerow()
    const doc = makeDoc({
      hedgerows: [
        {
          ...base,
          baseline: { ...base.baseline, type: 'Not a real hedgerow' }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.hedgerows[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('still enriches baseline sub-object even when proposed type is N/A', () => {
    const base = makeHedgerow()
    const doc = makeDoc({
      hedgerows: [
        {
          ...base,
          proposed: { ...base.proposed, type: 'N/A', condition: 'N/A' }
        }
      ]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    const hedge = doc.hedgerows[0]
    expect(typeof hedge.units).toBe('number')
    expect(hedge.baseline.distinctiveness).toBeTruthy()
  })

  it('skips proposed enrichment when sizeMetres is missing or not positive', () => {
    const base = makeHedgerow({ sizeMetres: 0 })
    const doc = makeDoc({ hedgerows: [base] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.hedgerows[0].status).toBe('Incomplete')
    expect(doc.hedgerows[0].units).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sizeMetres is missing or not positive')
    )
  })
})

describe('hedgerow — Created', () => {
  it('calculates units using proposed type/condition with multipliers', () => {
    const doc = makeDoc({ hedgerows: [makeCreatedHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const hedge = doc.hedgerows[0]
    expect(typeof hedge.units).toBe('number')
    expect(hedge.units).toBeGreaterThan(0)
    expect(hedge.status).toBe('Complete')
  })

  it('writes timeMultiplier and difficultyMultiplier to proposed sub-object', () => {
    const doc = makeDoc({ hedgerows: [makeCreatedHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.hedgerows[0].proposed
    expect(typeof proposed.timeMultiplier).toBe('number')
    expect(typeof proposed.difficultyMultiplier).toBe('number')
  })

  it('marks Incomplete when proposed condition is missing', () => {
    const base = makeCreatedHedgerow()
    const doc = makeDoc({
      hedgerows: [{ ...base, proposed: { ...base.proposed, condition: null } }]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.hedgerows[0].status).toBe('Incomplete')
  })
})

describe('hedgerow — Enhanced', () => {
  const BASELINE_LENGTH_BY_REF = new Map([['HW1', 1]])

  it('calculates units using both baseline and proposed hedge type', () => {
    const doc = makeDoc({ hedgerows: [makeEnhancedHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc, undefined, {
      baselineLengthByRef: BASELINE_LENGTH_BY_REF
    })

    const hedge = doc.hedgerows[0]
    expect(typeof hedge.units).toBe('number')
    expect(hedge.units).toBeGreaterThan(0)
    expect(hedge.status).toBe('Complete')
  })

  it('writes calculation and time/difficulty display fields to proposed', () => {
    const doc = makeDoc({ hedgerows: [makeEnhancedHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc, undefined, {
      baselineLengthByRef: BASELINE_LENGTH_BY_REF
    })

    const proposed = doc.hedgerows[0].proposed
    expect(proposed.distinctiveness).toBeTruthy()
    expect(typeof proposed.distinctivenessScore).toBe('number')
    expect(typeof proposed.conditionScore).toBe('number')
    expect(typeof proposed.timeMultiplier).toBe('number')
    expect(typeof proposed.difficultyMultiplier).toBe('number')
    expect(typeof proposed.standardTimeToTargetCondition).toBe('string')
    expect(typeof proposed.difficulty).toBe('string')
    expect(proposed.advanceOrDelay).toBe('Neither')
    expect(proposed.finalTimeToTargetCondition).toMatch(/^.+ years \(.+\)$/)
  })

  it('marks Incomplete and warns when baseline length lookup returns no match', () => {
    const doc = makeDoc({ hedgerows: [makeEnhancedHedgerow()] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger, {
      baselineLengthByRef: new Map()
    })

    expect(doc.hedgerows[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"HW1"'))
  })

  it('marks Incomplete when baseline or proposed type/condition is missing', () => {
    const base = makeEnhancedHedgerow()
    const doc = makeDoc({
      hedgerows: [
        {
          ...base,
          proposed: { ...base.proposed, type: null, condition: null }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger, {
      baselineLengthByRef: BASELINE_LENGTH_BY_REF
    })

    expect(doc.hedgerows[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('baseline or proposed type/condition is missing')
    )
  })
})

describe('hedgerow — legacy Lost linear', () => {
  it('marks Complete with 0 units and does not warn about unrecognised category', () => {
    const doc = makeDoc({ hedgerows: [makeLostHedgerow()] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    const hedge = doc.hedgerows[0]
    expect(hedge.units).toBe(0)
    expect(hedge.status).toBe('Complete')
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('unrecognised retention category')
    )
  })

  it('contributes 0 to the rolled-up hedgerow totals', () => {
    const doc = makeDoc({ hedgerows: [makeLostHedgerow()] })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.units.hedgerowsTotal).toBe(0)
  })
})

describe('hedgerow — Complete-never-null invariant', () => {
  it('downgrades a Complete feature to Incomplete when units cannot be calculated', () => {
    const base = makeHedgerow()
    const doc = makeDoc({
      hedgerows: [
        {
          ...base,
          status: 'Complete',
          retentionCategory: undefined,
          baseline: { ...base.baseline, retentionCategory: 'Partial' }
        }
      ]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.hedgerows[0].units).toBeNull()
    expect(doc.hedgerows[0].status).toBe('Incomplete')
  })
})

describe('hedgerow — unknown retention category', () => {
  it('skips proposed enrichment for an unrecognised category string', () => {
    const base = makeHedgerow()
    const doc = makeDoc({
      hedgerows: [
        {
          ...base,
          retentionCategory: undefined,
          baseline: { ...base.baseline, retentionCategory: 'Partial' }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.hedgerows[0].units).toBeNull()
    expect(doc.hedgerows[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognised retention category')
    )
  })

  it('marks the feature Incomplete when the linear feature engine throws an unexpected error', () => {
    const doc = makeDoc({ hedgerows: [makeHedgerow()] })
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      bngMetricEngine,
      'calculateRetainedHedgerowPostIntervention'
    ).mockImplementationOnce(() => {
      throw unexpected
    })
    const logger = { warn: vi.fn() }

    expect(() =>
      enrichPostInterventionDocumentWithUnits(doc, logger)
    ).not.toThrow()
    expect(doc.hedgerows[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('engine unavailable')
    )
  })

  it('re-throws unexpected errors from the hedgerow baseline engine', () => {
    const doc = makeDoc({ hedgerows: [makeHedgerow()] })
    const unexpected = new TypeError('baseline engine unavailable')
    vi.spyOn(
      bngMetricEngine,
      'calculateHedgerowBaseline'
    ).mockImplementationOnce(() => {
      throw unexpected
    })

    expect(() => enrichPostInterventionDocumentWithUnits(doc)).toThrow(
      unexpected
    )
  })
})
