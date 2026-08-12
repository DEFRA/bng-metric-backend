import { describe, it, expect, vi } from 'vitest'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import * as engineHelpers from '../shared/engine-helpers.js'
import {
  makeAreaHabitat,
  makeDoc,
  makeHedgerow
} from './enrich-post-intervention-units.fixtures.js'

describe('enrichPostInterventionDocumentWithUnits — unit totals', () => {
  it('sets document.units totals after enrichment', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat()] })
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.units).toEqual(
      expect.objectContaining({
        totalUnits: expect.any(Number),
        habitatsTotal: expect.any(Number),
        hedgerowsTotal: 0,
        watercoursesTotal: 0
      })
    )
    expect(doc.units.habitatsTotal).toBeGreaterThan(0)
  })

  it('handles an empty document gracefully', () => {
    const doc = {}
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.units).toEqual({
      totalUnits: 0,
      habitatsTotal: 0,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
  })

  it('adds net unit changes when baseline units are provided', () => {
    const doc = makeDoc()

    enrichPostInterventionDocumentWithUnits(
      doc,
      { warn: vi.fn() },
      {
        baselineUnits: {
          habitatsTotal: 6,
          treesTotal: 2,
          hedgerowsTotal: 4,
          watercoursesTotal: 3
        }
      }
    )

    expect(doc.units).toEqual(
      expect.objectContaining({
        habitatsNetUnitChange: -8,
        habitatsNetUnitChangePercentage: -100,
        hedgerowsNetUnitChange: -4,
        hedgerowsNetUnitChangePercentage: -100,
        watercoursesNetUnitChange: -3,
        watercoursesNetUnitChangePercentage: -100
      })
    )
  })

  it('re-throws unexpected errors from the area habitat baseline engine', () => {
    const doc = makeDoc({ habitats: [makeAreaHabitat()] })
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      engineHelpers,
      'calculateAreaHabitatWithCandidates'
    ).mockImplementationOnce(() => {
      throw unexpected
    })

    expect(() => enrichPostInterventionDocumentWithUnits(doc)).toThrow(
      unexpected
    )
  })

  it('logs a warning but leaves status unchanged when baseline-side hedgerow lookup fails', () => {
    const base = makeHedgerow()
    const doc = makeDoc({
      hedgerows: [
        {
          ...base,
          baseline: { ...base.baseline, type: 'Unrecognised baseline type' }
        }
      ]
    })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.hedgerows[0].baseline.distinctiveness).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('uses "unknown" in the warning message when an area habitat has no featureId', () => {
    const hab = makeAreaHabitat({
      baseline: {
        ...makeAreaHabitat().baseline,
        type: 'Not a real habitat',
        broadType: 'Unknown'
      }
    })
    delete hab.featureId
    const doc = makeDoc({ habitats: [hab] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown'))
  })

  it('uses "unknown" in the warning message when a hedgerow has no featureId', () => {
    const base = makeHedgerow()
    const hedge = {
      ...base,
      baseline: { ...base.baseline, type: 'Not a real hedgerow type' }
    }
    delete hedge.featureId
    const doc = makeDoc({ hedgerows: [hedge] })
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown'))
  })
})
