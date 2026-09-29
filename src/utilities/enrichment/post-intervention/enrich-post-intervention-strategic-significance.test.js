import { describe, it, expect, vi } from 'vitest'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import {
  makeAreaHabitat,
  makeCreatedAreaHabitat,
  makeCreatedHedgerow,
  makeCreatedWatercourse,
  makeDoc,
  makeEnhancedHabitat,
  makeEnhancedHedgerow,
  makeEnhancedWatercourse,
  makeHedgerow,
  makeWatercourse
} from './enrich-post-intervention-units.fixtures.js'

// BMD-1038 — created and enhanced units are multiplied by the feature's
// Proposed Strategic Significance; retained units carry the baseline value,
// which the service fixes at Low (×1).

const HIGH = 'Formally identified in local strategy'
const MEDIUM = 'Location ecologically desirable but not in local strategy'
const LOW = 'Area/compensation not in local strategy/ no local strategy'

const HIGH_MULTIPLIER = 1.15
const MEDIUM_MULTIPLIER = 1.1
const LOW_MULTIPLIER = 1
const DECIMAL_PLACES = 10

// Enhanced linear features price their baseline side from the baseline length
// of the same ref (the fixtures use HW1 and R1).
const BASELINE_LENGTH_BY_REF = new Map([
  ['HW1', 1],
  ['R1', 1]
])

const LAYERS = {
  habitats: {
    created: makeCreatedAreaHabitat,
    enhanced: makeEnhancedHabitat,
    retained: makeAreaHabitat
  },
  hedgerows: {
    created: makeCreatedHedgerow,
    enhanced: makeEnhancedHedgerow,
    retained: makeHedgerow
  },
  watercourses: {
    created: makeCreatedWatercourse,
    enhanced: makeEnhancedWatercourse,
    retained: makeWatercourse
  }
}

/**
 * Enrich a single feature carrying the given Proposed Strategic Significance.
 *
 * @param {string} layer
 * @param {() => object} makeFeature
 * @param {unknown} strategicSignificance
 * @param {{ warn: (msg: string) => void }} [logger]
 */
function enrich(layer, makeFeature, strategicSignificance, logger) {
  const feature = makeFeature()
  feature.proposed = { ...feature.proposed, strategicSignificance }
  const doc = makeDoc({ [layer]: [feature] })
  enrichPostInterventionDocumentWithUnits(doc, logger, {
    baselineLengthByRef: BASELINE_LENGTH_BY_REF
  })
  return doc[layer][0]
}

describe.each(Object.keys(LAYERS))('%s', (layer) => {
  describe.each(['created', 'enhanced'])('%s', (category) => {
    const makeFeature = LAYERS[layer][category]
    const lowUnits = () => enrich(layer, makeFeature, LOW).units

    it.each([
      [HIGH, 'High', HIGH_MULTIPLIER],
      [MEDIUM, 'Medium', MEDIUM_MULTIPLIER],
      [LOW, 'Low', LOW_MULTIPLIER]
    ])(
      'applies "%s" as %s (×%s) and records it on proposed',
      (label, band, multiplier) => {
        const feature = enrich(layer, makeFeature, label)

        expect(feature.status).toBe('Complete')
        expect(feature.units).toBeCloseTo(
          lowUnits() * multiplier,
          DECIMAL_PLACES
        )
        expect(feature.proposed.strategicSignificanceCategory).toBe(band)
        expect(feature.proposed.strategicSignificanceScore).toBe(multiplier)
      }
    )

    it('prices a blank value at Low', () => {
      const feature = enrich(layer, makeFeature, null)
      expect(feature.units).toBe(lowUnits())
      expect(feature.proposed.strategicSignificanceScore).toBe(LOW_MULTIPLIER)
    })

    it('prices an unrecognised value at Low and warns', () => {
      const logger = { warn: vi.fn() }
      const feature = enrich(layer, makeFeature, 'Very important', logger)

      expect(feature.status).toBe('Complete')
      expect(feature.units).toBe(lowUnits())
      expect(feature.proposed.strategicSignificanceScore).toBe(LOW_MULTIPLIER)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'unrecognised proposed strategic significance "Very important"'
        )
      )
    })
  })

  it('keeps a retained feature at Low (×1) whatever its proposed value', () => {
    const makeFeature = LAYERS[layer].retained
    const high = enrich(layer, makeFeature, HIGH)

    expect(high.units).toBe(enrich(layer, makeFeature, LOW).units)
    expect(high.proposed.strategicSignificanceScore).toBe(LOW_MULTIPLIER)
  })
})
