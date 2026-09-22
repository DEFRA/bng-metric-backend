import { describe, expect, test, vi } from 'vitest'

import {
  rederivePostInterventionFromBaseline,
  resyncPostInterventionBaselineSide
} from './resync-post-intervention-baseline.js'

const MODIFIED_GRASSLAND = 'Modified grassland' // Grassland, Low
const NEUTRAL_GRASSLAND = 'Other neutral grassland' // Grassland, Medium
const ONE_HECTARE = 10_000

/**
 * @param {object} overrides
 * @returns {object} a baseline area habitat
 */
function baselineHabitat({
  featureId = 'baseline-1',
  ref = 'A1',
  type = MODIFIED_GRASSLAND,
  broadType = 'Grassland',
  condition = 'Poor',
  strategicSignificance = 'Low',
  units = 2
} = {}) {
  return {
    featureId,
    ref,
    type,
    broadType,
    condition,
    strategicSignificance,
    area: ONE_HECTARE,
    sizeSquareMetres: ONE_HECTARE,
    units,
    status: 'Complete'
  }
}

/**
 * @param {object} overrides
 * @returns {object} a post-intervention area habitat
 */
function postInterventionHabitat({
  featureId = 'pi-1',
  ref = 'A1',
  retentionCategory = 'Retained',
  baseline = {},
  proposed = {}
} = {}) {
  return {
    featureId,
    ref,
    retentionCategory,
    area: ONE_HECTARE,
    sizeSquareMetres: ONE_HECTARE,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: MODIFIED_GRASSLAND,
      broadType: 'Grassland',
      condition: 'Poor',
      strategicSignificance: 'Low',
      ...baseline
    },
    proposed: {
      type: MODIFIED_GRASSLAND,
      broadType: 'Grassland',
      condition: 'Poor',
      strategicSignificance: 'Low',
      advanceYears: 0,
      delayYears: 0,
      ...proposed
    }
  }
}

describe('resyncPostInterventionBaselineSide', () => {
  test('copies the edited baseline identity onto the matching post-intervention row', () => {
    const postIntervention = { habitats: [postInterventionHabitat()] }
    const baselineDocument = {
      habitats: [
        baselineHabitat({ type: NEUTRAL_GRASSLAND, condition: 'Good' })
      ]
    }

    const changed = resyncPostInterventionBaselineSide(
      postIntervention,
      baselineDocument
    )

    expect(changed).toBe(1)
    expect(postIntervention.habitats[0].baseline).toMatchObject({
      type: NEUTRAL_GRASSLAND,
      broadType: 'Grassland',
      condition: 'Good'
    })
  })

  test('moves a Retained row’s proposed copy with the baseline it was copied from', () => {
    // copyRetainedProposedFromBaseline filled the proposed side from baseline at
    // extract time, so the two must stay in step.
    const postIntervention = { habitats: [postInterventionHabitat()] }

    resyncPostInterventionBaselineSide(postIntervention, {
      habitats: [
        baselineHabitat({ type: NEUTRAL_GRASSLAND, condition: 'Good' })
      ]
    })

    expect(postIntervention.habitats[0].proposed).toMatchObject({
      type: NEUTRAL_GRASSLAND,
      condition: 'Good'
    })
  })

  test('leaves a Retained proposed value the GeoPackage supplied itself', () => {
    const postIntervention = {
      habitats: [
        postInterventionHabitat({
          proposed: { type: NEUTRAL_GRASSLAND, condition: 'Moderate' }
        })
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      habitats: [baselineHabitat({ type: 'Allotments', broadType: 'Urban' })]
    })

    const [habitat] = postIntervention.habitats
    expect(habitat.baseline.type).toBe('Allotments')
    // Already diverged from the baseline copy, so it is the file's own value.
    expect(habitat.proposed.type).toBe(NEUTRAL_GRASSLAND)
    expect(habitat.proposed.condition).toBe('Moderate')
  })

  test('never touches the proposed side of a feature that is not Retained', () => {
    const postIntervention = {
      habitats: [
        postInterventionHabitat({
          retentionCategory: 'Enhanced',
          proposed: { condition: 'Poor' }
        })
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      habitats: [baselineHabitat({ condition: 'Good' })]
    })

    const [habitat] = postIntervention.habitats
    expect(habitat.baseline.condition).toBe('Good')
    expect(habitat.proposed.condition).toBe('Poor')
  })

  test('leaves a row whose ref is blank as imported', () => {
    const postIntervention = {
      habitats: [postInterventionHabitat({ ref: '  ' })]
    }

    const changed = resyncPostInterventionBaselineSide(postIntervention, {
      habitats: [baselineHabitat({ ref: null, type: NEUTRAL_GRASSLAND })]
    })

    expect(changed).toBe(0)
    expect(postIntervention.habitats[0].baseline.type).toBe(MODIFIED_GRASSLAND)
  })

  test('leaves a row whose ref is shared by two baseline features as imported', () => {
    const postIntervention = { habitats: [postInterventionHabitat()] }

    const changed = resyncPostInterventionBaselineSide(postIntervention, {
      habitats: [
        baselineHabitat({ featureId: 'baseline-1', type: NEUTRAL_GRASSLAND }),
        baselineHabitat({ featureId: 'baseline-2', type: 'Allotments' })
      ]
    })

    expect(changed).toBe(0)
    expect(postIntervention.habitats[0].baseline.type).toBe(MODIFIED_GRASSLAND)
  })

  test('only propagates fields the baseline document actually carries', () => {
    const postIntervention = { habitats: [postInterventionHabitat()] }
    const source = baselineHabitat({ type: NEUTRAL_GRASSLAND })
    delete source.strategicSignificance

    resyncPostInterventionBaselineSide(postIntervention, { habitats: [source] })

    expect(postIntervention.habitats[0].baseline.strategicSignificance).toBe(
      'Low'
    )
  })

  test('warns when a Retained row has no baseline feature to measure against', () => {
    const logger = { warn: vi.fn() }

    resyncPostInterventionBaselineSide(
      { habitats: [postInterventionHabitat({ ref: 'Z9' })] },
      { habitats: [baselineHabitat()] },
      logger
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain('Z9')
  })

  test('says nothing about a Created row, which is new habitat by definition', () => {
    const logger = { warn: vi.fn() }

    resyncPostInterventionBaselineSide(
      {
        habitats: [
          postInterventionHabitat({ ref: 'Z9', retentionCategory: 'Created' })
        ]
      },
      { habitats: [baselineHabitat()] },
      logger
    )

    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('re-syncs hedgerows and watercourses on their own identity fields', () => {
    const postIntervention = {
      hedgerows: [
        {
          featureId: 'pi-h1',
          ref: 'H1',
          retentionCategory: 'Retained',
          sizeMetres: 500,
          baseline: { type: 'Native hedgerow', condition: 'Poor' },
          proposed: { type: 'Native hedgerow', condition: 'Poor' }
        }
      ],
      watercourses: [
        {
          featureId: 'pi-w1',
          ref: 'W1',
          retentionCategory: 'Retained',
          sizeMetres: 500,
          baseline: {
            type: 'Ditches',
            condition: 'Poor',
            riparianEncroachment: 'Minor/Minor',
            watercourseEncroachment: 'Minor'
          },
          proposed: {
            type: 'Ditches',
            condition: 'Poor',
            riparianEncroachment: 'Minor/Minor',
            watercourseEncroachment: 'Minor'
          }
        }
      ]
    }

    resyncPostInterventionBaselineSide(postIntervention, {
      hedgerows: [
        {
          featureId: 'b-h1',
          ref: 'H1',
          type: 'Species-rich native hedgerow',
          condition: 'Good'
        }
      ],
      watercourses: [
        {
          featureId: 'b-w1',
          ref: 'W1',
          type: 'Ditches',
          condition: 'Moderate',
          riparianEncroachment: 'Extensive/Extensive',
          watercourseEncroachment: 'Extensive'
        }
      ]
    })

    expect(postIntervention.hedgerows[0].baseline).toMatchObject({
      type: 'Species-rich native hedgerow',
      condition: 'Good'
    })
    expect(postIntervention.watercourses[0].baseline).toMatchObject({
      condition: 'Moderate',
      riparianEncroachment: 'Extensive/Extensive',
      watercourseEncroachment: 'Extensive'
    })
  })
})

describe('rederivePostInterventionFromBaseline', () => {
  test('returns null when the project has no post-intervention document', () => {
    expect(rederivePostInterventionFromBaseline(null, {})).toBeNull()
    expect(rederivePostInterventionFromBaseline(undefined, {})).toBeNull()
  })

  test('does not mutate the stored document', () => {
    const stored = { habitats: [postInterventionHabitat()], units: {} }
    const before = structuredClone(stored)

    rederivePostInterventionFromBaseline(stored, {
      habitats: [
        baselineHabitat({ type: NEUTRAL_GRASSLAND, condition: 'Good' })
      ],
      units: { totalUnits: 6, habitatsTotal: 6 }
    })

    expect(stored).toEqual(before)
  })

  test('recomputes the trading-rules figures against the edited baseline', () => {
    const rederived = rederivePostInterventionFromBaseline(
      { habitats: [postInterventionHabitat()], trees: [], units: {} },
      {
        habitats: [
          baselineHabitat({
            type: NEUTRAL_GRASSLAND,
            condition: 'Good',
            units: 12
          })
        ],
        units: { totalUnits: 12, habitatsTotal: 12 }
      }
    )

    // The Low-band habitat the figures used to be measured against is gone —
    // both sides of the comparison now name the edited habitat.
    expect(
      rederived.tradingRules.areaHabitats.habitatTypes.map(
        (entry) => entry.habitatType
      )
    ).toEqual(['Grassland - Other neutral grassland'])
    // A Retained parcel delivers exactly what the baseline holds, so it nets
    // out — which is only true once the post-intervention side was re-synced.
    expect(
      rederived.tradingRules.areaHabitats.habitatTypes[0].netUnitChange
    ).toBe(0)
    expect(rederived.units.habitatsTotal).toBe(12)
    expect(rederived.units.habitatsNetUnitChange).toBe(0)
  })
})
