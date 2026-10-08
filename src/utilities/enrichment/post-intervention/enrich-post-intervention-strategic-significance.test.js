import { describe, it, expect, vi } from 'vitest'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import {
  INVALID_STRATEGIC_SIGNIFICANCE_REASON as REASON,
  STRATEGIC_SIGNIFICANCE_INVALID_EVENT
} from './enrich-post-intervention-shared.js'
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
// which the service fixes at Low (×1). BMD-1051 — only Low and High are valid;
// Medium (×1.10) is not supported, and an invalid value is nulled and priced
// at zero.

const HIGH = 'Formally identified in local strategy'
const MEDIUM = 'Location ecologically desirable but not in local strategy'
const LOW = 'Area/compensation not in local strategy/ no local strategy'

const HIGH_MULTIPLIER = 1.15
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
      [LOW, 'Low', LOW_MULTIPLIER],
      ['High', 'High', HIGH_MULTIPLIER],
      ['Low', 'Low', LOW_MULTIPLIER]
    ])(
      'applies "%s" as %s (×%s) and records it on proposed',
      (label, band, multiplier) => {
        const feature = enrich(layer, makeFeature, label)

        expect(feature.status).toBe('Complete')
        expect(feature.units).toBeCloseTo(
          lowUnits() * multiplier,
          DECIMAL_PLACES
        )
        expect(feature.proposed.strategicSignificance).toBe(label)
        expect(feature.proposed.strategicSignificanceCategory).toBe(band)
        expect(feature.proposed.strategicSignificanceScore).toBe(multiplier)
      }
    )

    // BMD-1051 AC4 — anything but Low or High is invalid: the value is nulled,
    // the units are zero by definition, and the feature is saved Incomplete so
    // the user can be asked to pick a valid value.
    it.each([
      ['Medium', MEDIUM, REASON.MEDIUM],
      ['the Medium category name', 'Medium', REASON.MEDIUM],
      ['an unrecognised value', 'Very important', REASON.UNRECOGNISED],
      ['N/A', 'N/A', REASON.UNRECOGNISED],
      ['an empty string', '', REASON.BLANK],
      ['whitespace', '   ', REASON.BLANK],
      ['null', null, REASON.BLANK],
      ['undefined', undefined, REASON.BLANK]
    ])('nulls %s, prices it at zero and warns', (_name, value, reason) => {
      const logger = { warn: vi.fn() }
      const feature = enrich(layer, makeFeature, value, logger)

      expect(feature.status).toBe('Incomplete')
      expect(feature.units).toBe(0)
      expect(feature.proposed.strategicSignificance).toBeNull()
      expect(feature.proposed.strategicSignificanceCategory).toBeNull()
      expect(feature.proposed.strategicSignificanceScore).toBeNull()
      expect(feature.proposed.rejectedStrategicSignificance).toBe(
        reason === REASON.BLANK ? null : value
      )
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: STRATEGIC_SIGNIFICANCE_INVALID_EVENT,
          layer: expect.any(String),
          featureId: feature.featureId,
          value: value ?? null,
          reason
        }),
        expect.stringContaining(
          `invalid proposed strategic significance ${JSON.stringify(value)} (${reason})`
        )
      )
    })
  })

  describe.each(['created', 'enhanced'])('%s, unpriceable', (category) => {
    // The strategic significance is checked before the other inputs, so an
    // invalid value is nulled and priced at zero even when the feature could
    // not be priced anyway (here, no proposed condition).
    it('nulls an invalid value when the proposed condition is missing', () => {
      const feature = LAYERS[layer][category]()
      feature.proposed = {
        ...feature.proposed,
        condition: null,
        strategicSignificance: MEDIUM
      }
      const doc = makeDoc({ [layer]: [feature] })
      enrichPostInterventionDocumentWithUnits(doc, undefined, {
        baselineLengthByRef: BASELINE_LENGTH_BY_REF
      })
      const [enriched] = doc[layer]

      expect(enriched.status).toBe('Incomplete')
      expect(enriched.units).toBe(0)
      expect(enriched.proposed.strategicSignificance).toBeNull()
      expect(enriched.proposed.rejectedStrategicSignificance).toBe(MEDIUM)
    })
  })

  describe.each(['created', 'enhanced'])('%s, unsized', (category) => {
    // A feature with no valid size is skipped before its builder runs; its
    // strategic significance is still checked there.
    it('nulls an invalid value when the feature has no size', () => {
      const feature = LAYERS[layer][category]()
      Object.assign(feature, { sizeSquareMetres: 0, area: 0, sizeMetres: 0 })
      feature.proposed = { ...feature.proposed, strategicSignificance: MEDIUM }
      const doc = makeDoc({ [layer]: [feature] })
      enrichPostInterventionDocumentWithUnits(doc, undefined, {
        baselineLengthByRef: BASELINE_LENGTH_BY_REF
      })
      const [enriched] = doc[layer]

      expect(enriched.status).toBe('Incomplete')
      expect(enriched.units).toBe(0)
      expect(enriched.proposed.strategicSignificance).toBeNull()
      expect(enriched.proposed.rejectedStrategicSignificance).toBe(MEDIUM)
    })

    it('leaves a valid value alone when the feature has no size', () => {
      const feature = LAYERS[layer][category]()
      Object.assign(feature, { sizeSquareMetres: 0, area: 0, sizeMetres: 0 })
      feature.proposed = { ...feature.proposed, strategicSignificance: HIGH }
      const doc = makeDoc({ [layer]: [feature] })
      enrichPostInterventionDocumentWithUnits(doc, undefined, {
        baselineLengthByRef: BASELINE_LENGTH_BY_REF
      })

      expect(doc[layer][0].proposed.strategicSignificance).toBe(HIGH)
    })
  })

  describe.each(['created', 'enhanced'])('%s, priced again', (category) => {
    const makeFeature = LAYERS[layer][category]

    function enrichAgain(feature) {
      const doc = makeDoc({ [layer]: [feature] })
      enrichPostInterventionDocumentWithUnits(doc, undefined, {
        baselineLengthByRef: BASELINE_LENGTH_BY_REF
      })
      return doc[layer][0]
    }

    it('keeps the rejected value when the nulled feature is priced again', () => {
      const again = enrichAgain(enrich(layer, makeFeature, MEDIUM))

      expect(again.units).toBe(0)
      expect(again.status).toBe('Incomplete')
      expect(again.proposed.rejectedStrategicSignificance).toBe(MEDIUM)
    })

    it('clears what an earlier pricing derived when the value is rejected', () => {
      const priced = enrich(layer, makeFeature, HIGH)
      expect(priced.proposed.distinctiveness).not.toBeNull()
      priced.proposed.strategicSignificance = MEDIUM
      const rejected = enrichAgain(priced)

      expect(rejected.proposed).toMatchObject({
        distinctiveness: null,
        distinctivenessScore: null,
        conditionScore: null,
        timeMultiplier: null,
        difficultyMultiplier: null,
        difficulty: null,
        standardTimeToTargetCondition: null,
        finalTimeToTargetCondition: null
      })
    })

    it('clears the rejected value once a valid one is priced', () => {
      const rejected = enrich(layer, makeFeature, MEDIUM)
      rejected.proposed.strategicSignificance = HIGH
      const fixed = enrichAgain(rejected)

      expect(fixed.status).toBe('Complete')
      expect(fixed.proposed.strategicSignificanceCategory).toBe('High')
      expect(fixed.proposed.rejectedStrategicSignificance).toBeNull()
    })
  })

  it('keeps a retained feature at Low (×1) whatever its proposed value', () => {
    const makeFeature = LAYERS[layer].retained
    const high = enrich(layer, makeFeature, HIGH)

    expect(high.units).toBe(enrich(layer, makeFeature, LOW).units)
    expect(high.proposed.strategicSignificanceScore).toBe(LOW_MULTIPLIER)
  })
})

describe('the layer a rejection is logged against', () => {
  // Individual trees price on the area-habitat path, so its warnings must
  // still name the tree layer, or the per-layer counts are wrong.
  it.each([
    ['habitats', 'Habitat parcel'],
    ['trees', 'Individual tree']
  ])('logs a rejected %s value against "%s"', (layer, label) => {
    const feature = makeCreatedAreaHabitat()
    feature.proposed = { ...feature.proposed, strategicSignificance: MEDIUM }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(
      makeDoc({ [layer]: [feature] }),
      logger
    )

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: STRATEGIC_SIGNIFICANCE_INVALID_EVENT,
        layer: label
      }),
      expect.any(String)
    )
  })
})
