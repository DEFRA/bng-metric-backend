import { describe, it, expect, vi } from 'vitest'

import * as bngMetricEngine from 'bng-metric-engine'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import {
  makeCreatedWatercourse,
  makeDoc,
  makeEnhancedWatercourse,
  makeWatercourse
} from './enrich-post-intervention-units.fixtures.js'

describe('watercourse — Retained', () => {
  it('calculates units using baseline encroachments and post-intervention length', () => {
    const doc = makeDoc({ watercourses: [makeWatercourse()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const wc = doc.watercourses[0]
    expect(typeof wc.units).toBe('number')
    expect(wc.units).toBeGreaterThan(0)
    expect(wc.status).toBe('Complete')
  })

  it('writes encroachment multipliers to proposed sub-object from baseline encroachments', () => {
    const doc = makeDoc({ watercourses: [makeWatercourse()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.watercourses[0].proposed
    expect(typeof proposed.waterEncroachmentMultiplier).toBe('number')
    expect(typeof proposed.riparianEncroachmentMultiplier).toBe('number')
  })

  it('also enriches baseline sub-object with scores and multipliers', () => {
    const doc = makeDoc({ watercourses: [makeWatercourse()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const baseline = doc.watercourses[0].baseline
    expect(baseline.distinctiveness).toBeTruthy()
    expect(typeof baseline.waterEncroachmentMultiplier).toBe('number')
    expect(typeof baseline.riparianEncroachmentMultiplier).toBe('number')
  })

  it('still enriches baseline when proposed side is N/A', () => {
    const base = makeWatercourse()
    const doc = makeDoc({
      watercourses: [
        {
          ...base,
          proposed: {
            ...base.proposed,
            type: 'N/A',
            condition: 'N/A'
          }
        }
      ]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    const wc = doc.watercourses[0]
    expect(typeof wc.units).toBe('number')
    expect(wc.baseline.distinctiveness).toBeTruthy()
  })

  it('skips proposed enrichment when sizeMetres is missing or not positive', () => {
    const base = makeWatercourse({ sizeMetres: -1 })
    const doc = makeDoc({ watercourses: [base] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.watercourses[0].status).toBe('Incomplete')
    expect(doc.watercourses[0].units).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sizeMetres is missing or not positive')
    )
  })

  it('marks Incomplete when baseline condition is missing', () => {
    const base = makeWatercourse()
    const doc = makeDoc({
      watercourses: [
        { ...base, baseline: { ...base.baseline, condition: null } }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.watercourses[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('baseline type or condition is missing')
    )
  })
})

describe('watercourse — Created', () => {
  it('calculates units using proposed properties with multipliers', () => {
    const doc = makeDoc({ watercourses: [makeCreatedWatercourse()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const wc = doc.watercourses[0]
    expect(typeof wc.units).toBe('number')
    expect(wc.units).toBeGreaterThan(0)
    expect(wc.status).toBe('Complete')
  })

  it('writes timeMultiplier and difficultyMultiplier to proposed sub-object', () => {
    const doc = makeDoc({ watercourses: [makeCreatedWatercourse()] })
    enrichPostInterventionDocumentWithUnits(doc)

    const proposed = doc.watercourses[0].proposed
    expect(typeof proposed.timeMultiplier).toBe('number')
    expect(typeof proposed.difficultyMultiplier).toBe('number')
  })

  it('normalises prefixed retention category "1. Created"', () => {
    const base = makeCreatedWatercourse()
    const doc = makeDoc({
      watercourses: [
        {
          ...base,
          baseline: { ...base.baseline, retentionCategory: '1. Created' }
        }
      ]
    })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.watercourses[0].status).toBe('Complete')
  })

  it('marks Incomplete when proposed condition is missing', () => {
    const base = makeCreatedWatercourse()
    const doc = makeDoc({
      watercourses: [
        { ...base, proposed: { ...base.proposed, condition: null } }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.watercourses[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('proposed type or condition is missing')
    )
  })
})

describe('watercourse — Enhanced', () => {
  const BASELINE_LENGTH_BY_REF = new Map([['R1', 1]])

  it('calculates Enhanced units using baseline length from lookup map', () => {
    const doc = makeDoc({ watercourses: [makeEnhancedWatercourse()] })
    enrichPostInterventionDocumentWithUnits(doc, undefined, {
      baselineLengthByRef: BASELINE_LENGTH_BY_REF
    })

    const wc = doc.watercourses[0]
    expect(typeof wc.units).toBe('number')
    expect(wc.units).toBeGreaterThan(0)
    expect(wc.status).toBe('Complete')
  })

  it('writes postIntervention multipliers and distinctiveness to proposed sub-object', () => {
    const doc = makeDoc({ watercourses: [makeEnhancedWatercourse()] })
    enrichPostInterventionDocumentWithUnits(doc, undefined, {
      baselineLengthByRef: BASELINE_LENGTH_BY_REF
    })

    const proposed = doc.watercourses[0].proposed
    expect(proposed.distinctiveness).toBeTruthy()
    expect(typeof proposed.distinctivenessScore).toBe('number')
    expect(typeof proposed.conditionScore).toBe('number')
    expect(typeof proposed.timeMultiplier).toBe('number')
    expect(typeof proposed.difficultyMultiplier).toBe('number')
  })

  it('marks Incomplete and warns when baseline length lookup returns no match', () => {
    const doc = makeDoc({ watercourses: [makeEnhancedWatercourse()] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger, {
      baselineLengthByRef: new Map()
    })

    expect(doc.watercourses[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"R1"'))
  })

  it('marks Incomplete and warns when baselineLengthByRef is not provided', () => {
    const doc = makeDoc({ watercourses: [makeEnhancedWatercourse()] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.watercourses[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('marks Incomplete when baseline or proposed type/condition is missing', () => {
    const base = makeEnhancedWatercourse()
    const doc = makeDoc({
      watercourses: [
        {
          ...base,
          baseline: { ...base.baseline, type: null, condition: null }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger, {
      baselineLengthByRef: BASELINE_LENGTH_BY_REF
    })

    expect(doc.watercourses[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('baseline or proposed type/condition is missing')
    )
  })
})

describe('watercourse — unknown retention category', () => {
  it('skips proposed enrichment for an unrecognised category string', () => {
    const base = makeWatercourse()
    const doc = makeDoc({
      watercourses: [
        {
          ...base,
          baseline: { ...base.baseline, retentionCategory: 'Partial' }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.watercourses[0].units).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognised retention category')
    )
  })

  it('re-throws unexpected errors from the watercourse engine', () => {
    const doc = makeDoc({ watercourses: [makeWatercourse()] })
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      bngMetricEngine,
      'calculateRetainedWatercoursePostIntervention'
    ).mockImplementationOnce(() => {
      throw unexpected
    })

    expect(() => enrichPostInterventionDocumentWithUnits(doc)).toThrow(
      unexpected
    )
  })
})
