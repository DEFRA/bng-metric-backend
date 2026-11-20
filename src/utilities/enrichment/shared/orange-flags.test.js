import { describe, expect, it } from 'vitest'

import {
  ORANGE_FLAG,
  ORANGE_FLAG_CODES,
  UNIT_KIND,
  deriveBaselineOrangeFlags,
  derivePostInterventionOrangeFlags,
  timeToPoorCondition,
  yearsReach
} from './orange-flags.js'

const {
  TARGET_CONDITION_REACHED: FLAG1,
  POOR_THRESHOLD_PASSED: FLAG2,
  CREATION_IN_PLACE: FLAG3,
  STARTED_IN_ADVANCE: FLAG4,
  DELAYED_START: FLAG5,
  LOW_DIFFICULTY: FLAG6,
  FAIRLY_CONDITION: FLAG7,
  BROAD_HABITAT_CHANGE: FLAG8,
  OVER_THIRTY_YEARS: FLAG9,
  WATERCOURSE_FOOTPRINT: FLAG10
} = ORANGE_FLAG

const HEAD_START_FLAGS = [FLAG1, FLAG2, FLAG3, FLAG4, FLAG5]
const MAX_ADVANCE = 30

// Real reference habitats, chosen for their time to Poor condition.
const NEUTRAL_GRASSLAND = {
  type: 'Other neutral grassland',
  broadType: 'Grassland'
} // Poor in 2
const OPEN_MOSAIC = {
  type: 'Open mosaic habitats on previously developed land',
  broadType: 'Urban'
} // Poor in 0
const ARABLE_MARGINS = {
  type: 'Arable field margins cultivated annually',
  broadType: 'Cropland'
} // Poor "Not Possible"
const LIMESTONE_PAVEMENT = {
  type: 'Limestone pavement',
  broadType: 'Sparsely vegetated land'
} // Poor "30+"

function createdArea(overrides = {}) {
  return {
    unitKind: UNIT_KIND.AREA,
    category: 'Created',
    ...NEUTRAL_GRASSLAND,
    condition: 'Good',
    distinctivenessScore: 4,
    standardTimeToTargetCondition: '10',
    advanceYears: null,
    delayYears: null,
    ...overrides
  }
}

function enhanced(unitKind, overrides = {}) {
  return {
    unitKind,
    category: 'Enhanced',
    type: 'Native hedgerow',
    condition: 'Good',
    distinctivenessScore: 2,
    standardTimeToTargetCondition: '10',
    advanceYears: null,
    delayYears: null,
    ...overrides
  }
}

function createdLinear(unitKind, overrides = {}) {
  return { ...enhanced(unitKind, overrides), category: 'Created', ...overrides }
}

describe('yearsReach', () => {
  it.each([
    [10, 10, true],
    [9, 10, false],
    [10, '10', true],
    [0, 0, true],
    [30, '30+', true],
    [29, '30+', false],
    [30, '>30', true],
    [30, 'Not Possible', false],
    [30, null, false],
    [30, '', false]
  ])('%s years reach %j: %s', (years, reference, expected) => {
    expect(yearsReach(years, reference)).toBe(expected)
  })
})

describe('timeToPoorCondition', () => {
  it.each([
    [NEUTRAL_GRASSLAND, 2],
    [OPEN_MOSAIC, 0],
    [ARABLE_MARGINS, 'Not Possible'],
    [LIMESTONE_PAVEMENT, '30+'],
    [{ type: 'Grassland - Other neutral grassland' }, 2]
  ])('looks up %j', (habitat, expected) => {
    expect(timeToPoorCondition(habitat)).toBe(expected)
  })

  it('is null for an unrecognised habitat', () => {
    expect(timeToPoorCondition({ type: 'Not a habitat' })).toBeNull()
  })
})

describe('derivePostInterventionOrangeFlags', () => {
  describe('AC1 head start, target condition already reached', () => {
    it('raises FLAG1 and FLAG6 when the advance equals the standard time', () => {
      expect(
        derivePostInterventionOrangeFlags(createdArea({ advanceYears: 10 }))
      ).toEqual([FLAG1, FLAG6])
    })

    it('raises FLAG1 and FLAG6 when the advance exceeds the standard time', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.WATERCOURSE, { advanceYears: 12 })
        )
      ).toEqual([FLAG1, FLAG6])
    })

    it('treats a 30 year ("30+") advance as reaching a "30+" standard', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.AREA, {
            standardTimeToTargetCondition: '>30',
            advanceYears: MAX_ADVANCE
          })
        )
      ).toEqual([FLAG1, FLAG6, FLAG9])
    })

    it('raises nothing for a created area habitat of distinctiveness score 0', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({ distinctivenessScore: 0, advanceYears: 10 })
        )
      ).toEqual([])
    })

    it('still applies to an enhanced area habitat of distinctiveness score 0', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.AREA, {
            distinctivenessScore: 0,
            advanceYears: 10
          })
        )
      ).toEqual([FLAG1, FLAG6])
    })
  })

  describe('AC2 head start, Poor condition threshold already passed', () => {
    it('raises FLAG2 when the advance equals the time to Poor', () => {
      expect(
        derivePostInterventionOrangeFlags(createdArea({ advanceYears: 2 }))
      ).toEqual([FLAG2])
    })

    it('raises FLAG2 between the time to Poor and the standard time', () => {
      expect(
        derivePostInterventionOrangeFlags(createdArea({ advanceYears: 9 }))
      ).toEqual([FLAG2])
    })

    it('raises FLAG2 for any advance when the time to Poor is 0', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({ ...OPEN_MOSAIC, advanceYears: 1 })
        )
      ).toEqual([FLAG2])
    })
  })

  describe('AC3 head start, target condition not yet reached', () => {
    it('raises FLAG3 when the advance is short of the time to Poor', () => {
      expect(
        derivePostInterventionOrangeFlags(createdArea({ advanceYears: 1 }))
      ).toEqual([FLAG3])
    })

    it('raises FLAG3 when Poor condition is "Not Possible"', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({ ...ARABLE_MARGINS, advanceYears: 5 })
        )
      ).toEqual([FLAG3])
    })

    it('raises FLAG3 when the time to Poor is "30+" and the advance is under 30', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({
            ...LIMESTONE_PAVEMENT,
            standardTimeToTargetCondition: '>30',
            advanceYears: 29
          })
        )
      ).toEqual([FLAG3, FLAG9])
    })
  })

  it('raises no head-start flag for a created area habitat with no distinctiveness score', () => {
    expect(
      derivePostInterventionOrangeFlags(
        createdArea({ distinctivenessScore: null, advanceYears: 3 })
      )
    ).toEqual([])
  })

  describe('AC4 head start, any other', () => {
    it.each([
      ['an enhanced area', enhanced(UNIT_KIND.AREA)],
      ['an enhanced hedgerow', enhanced(UNIT_KIND.HEDGEROW)],
      ['an enhanced watercourse', enhanced(UNIT_KIND.WATERCOURSE)],
      ['a created hedgerow', createdLinear(UNIT_KIND.HEDGEROW)],
      ['a created watercourse', createdLinear(UNIT_KIND.WATERCOURSE)]
    ])('raises FLAG4 for %s started short of target', (_label, habitat) => {
      expect(
        derivePostInterventionOrangeFlags({ ...habitat, advanceYears: 3 })
      ).toEqual([FLAG4])
    })
  })

  describe('AC5 delayed start', () => {
    it('raises FLAG5 for a delay', () => {
      expect(
        derivePostInterventionOrangeFlags(createdArea({ delayYears: 3 }))
      ).toEqual([FLAG5])
    })

    it('raises FLAG5 and FLAG9 when the delay takes the final time past 30', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.HEDGEROW, { delayYears: 21 })
        )
      ).toEqual([FLAG5, FLAG9])
    })

    it('raises nothing for a created area habitat of distinctiveness score 0', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({ distinctivenessScore: 0, delayYears: 3 })
        )
      ).toEqual([])
    })
  })

  describe('AC7 "Fairly" conditions', () => {
    it.each(['Fairly Good', 'Fairly Poor', '2. Fairly Good'])(
      'raises FLAG7 for an area habitat in %s condition',
      (condition) => {
        expect(
          derivePostInterventionOrangeFlags(createdArea({ condition }))
        ).toEqual([FLAG7])
      }
    )

    it('raises FLAG7 for a ditch', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.WATERCOURSE, {
            type: 'Ditches',
            condition: 'Fairly Poor'
          })
        )
      ).toEqual([FLAG7])
    })

    it('does not raise FLAG7 for other watercourses or hedgerows', () => {
      for (const habitat of [
        enhanced(UNIT_KIND.WATERCOURSE, {
          type: 'Other rivers and streams',
          condition: 'Fairly Good'
        }),
        enhanced(UNIT_KIND.HEDGEROW, { condition: 'Fairly Good' })
      ]) {
        expect(derivePostInterventionOrangeFlags(habitat)).toEqual([])
      }
    })
  })

  describe('AC8 change in broad habitat', () => {
    it('raises FLAG8 when an enhanced area changes broad habitat', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.AREA, {
            broadType: 'Grassland',
            baselineBroadType: 'Cropland'
          })
        )
      ).toEqual([FLAG8])
    })

    it('does not raise FLAG8 when the broad habitat is unchanged or unknown', () => {
      for (const baselineBroadType of ['Grassland', ' Grassland ', null]) {
        expect(
          derivePostInterventionOrangeFlags(
            enhanced(UNIT_KIND.AREA, {
              broadType: 'Grassland',
              baselineBroadType
            })
          )
        ).toEqual([])
      }
    })

    it('does not raise FLAG8 for a created area or an enhanced hedgerow', () => {
      const change = { broadType: 'Grassland', baselineBroadType: 'Cropland' }
      expect(derivePostInterventionOrangeFlags(createdArea(change))).toEqual([])
      expect(
        derivePostInterventionOrangeFlags(enhanced(UNIT_KIND.HEDGEROW, change))
      ).toEqual([])
    })
  })

  describe('AC9 more than 30 years', () => {
    it('raises FLAG9 for a "30+" standard time', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({ standardTimeToTargetCondition: '>30' })
        )
      ).toEqual([FLAG9])
    })

    it('raises FLAG9 alongside FLAG3 when an advance does not cover a "30+" standard', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({ standardTimeToTargetCondition: '>30', advanceYears: 1 })
        )
      ).toEqual([FLAG3, FLAG9])
    })

    it('does not raise FLAG9 when the delay takes the final time to exactly 30', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.HEDGEROW, { delayYears: 20 })
        )
      ).toEqual([FLAG5])
    })
  })

  describe('AC10 watercourse footprint', () => {
    const footprint = {
      type: 'Watercourse footprint',
      broadType: 'Watercourse footprint',
      condition: 'Condition Assessment N/A'
    }

    it('raises FLAG10 for a created watercourse footprint', () => {
      expect(derivePostInterventionOrangeFlags(createdArea(footprint))).toEqual(
        [FLAG10]
      )
    })

    it('does not raise FLAG10 for an enhanced one', () => {
      expect(
        derivePostInterventionOrangeFlags(enhanced(UNIT_KIND.AREA, footprint))
      ).toEqual([])
    })
  })

  describe('AC12 multiple flags', () => {
    it('raises every applicable flag, in code order', () => {
      expect(
        derivePostInterventionOrangeFlags(
          enhanced(UNIT_KIND.AREA, {
            broadType: 'Grassland',
            baselineBroadType: 'Cropland',
            condition: 'Fairly Good',
            standardTimeToTargetCondition: '>30',
            advanceYears: MAX_ADVANCE
          })
        )
      ).toEqual([FLAG1, FLAG6, FLAG7, FLAG8, FLAG9])
    })
  })

  describe('AC13 no flags', () => {
    it('raises nothing for a created habitat started on time', () => {
      expect(derivePostInterventionOrangeFlags(createdArea())).toEqual([])
    })

    it.each(['Retained', 'Lost', null])(
      'raises nothing for a %s habitat',
      (category) => {
        expect(
          derivePostInterventionOrangeFlags(
            createdArea({ category, condition: 'Fairly Good', delayYears: 5 })
          )
        ).toEqual([])
      }
    )

    it('raises no timing flag for a habitat that could not be priced', () => {
      expect(
        derivePostInterventionOrangeFlags(
          createdArea({
            standardTimeToTargetCondition: null,
            distinctivenessScore: null,
            advanceYears: 5,
            condition: 'Fairly Poor'
          })
        )
      ).toEqual([FLAG7])
    })
  })

  describe('AC12 at most one head-start flag, whatever the inputs', () => {
    const standards = ['0', '1', '5', '10', '30', '>30', '30+']
    const habitatTypes = [
      NEUTRAL_GRASSLAND,
      OPEN_MOSAIC,
      ARABLE_MARGINS,
      LIMESTONE_PAVEMENT
    ]
    const years = [null, 0, 1, 2, 5, 10, 29, 30]
    const shapes = [
      { unitKind: UNIT_KIND.AREA, category: 'Created' },
      { unitKind: UNIT_KIND.AREA, category: 'Enhanced' },
      { unitKind: UNIT_KIND.HEDGEROW, category: 'Created' },
      { unitKind: UNIT_KIND.HEDGEROW, category: 'Enhanced' },
      { unitKind: UNIT_KIND.WATERCOURSE, category: 'Created' },
      { unitKind: UNIT_KIND.WATERCOURSE, category: 'Enhanced' }
    ]

    function* permutations() {
      for (const shape of shapes) {
        for (const habitatType of habitatTypes) {
          for (const distinctivenessScore of [0, 2]) {
            for (const standardTimeToTargetCondition of standards) {
              for (const advanceYears of years) {
                for (const delayYears of years) {
                  yield {
                    ...shape,
                    ...habitatType,
                    distinctivenessScore,
                    standardTimeToTargetCondition,
                    advanceYears,
                    delayYears
                  }
                }
              }
            }
          }
        }
      }
    }

    it('never raises two of FLAG1-FLAG5, raises FLAG6 exactly with FLAG1, and never raises FLAG4 for a created area', () => {
      let checked = 0
      for (const habitat of permutations()) {
        const flags = derivePostInterventionOrangeFlags(habitat)
        const headStarts = flags.filter((flag) =>
          HEAD_START_FLAGS.includes(flag)
        )
        expect(headStarts.length, JSON.stringify(habitat)).toBeLessThanOrEqual(
          1
        )
        expect(flags.includes(FLAG6), JSON.stringify(habitat)).toBe(
          flags.includes(FLAG1)
        )
        if (
          habitat.category === 'Created' &&
          habitat.unitKind === UNIT_KIND.AREA
        ) {
          expect(flags, JSON.stringify(habitat)).not.toContain(FLAG4)
        }
        expect(flags).toEqual(
          ORANGE_FLAG_CODES.filter((code) => flags.includes(code))
        )
        checked += 1
      }
      expect(checked).toBeGreaterThan(0)
    })

    it('raises a head-start flag for every created area habitat with an advance and a positive score (AC4 note)', () => {
      for (const habitat of permutations()) {
        const isCovered =
          habitat.category === 'Created' &&
          habitat.unitKind === UNIT_KIND.AREA &&
          habitat.distinctivenessScore > 0 &&
          habitat.advanceYears > 0 &&
          // Import nulls an advance and a delay given together.
          (habitat.delayYears ?? 0) === 0
        if (isCovered) {
          const flags = derivePostInterventionOrangeFlags(habitat)
          expect(
            flags.some((flag) => [FLAG1, FLAG2, FLAG3].includes(flag)),
            JSON.stringify(habitat)
          ).toBe(true)
        }
      }
    })
  })
})

describe('deriveBaselineOrangeFlags', () => {
  it('raises FLAG7 for an area habitat in a "Fairly" condition', () => {
    expect(
      deriveBaselineOrangeFlags({
        unitKind: UNIT_KIND.AREA,
        ...NEUTRAL_GRASSLAND,
        condition: 'Fairly Poor'
      })
    ).toEqual([FLAG7])
  })

  it('raises FLAG7 for a ditch but not another watercourse', () => {
    expect(
      deriveBaselineOrangeFlags({
        unitKind: UNIT_KIND.WATERCOURSE,
        type: 'Ditches',
        condition: 'Fairly Good'
      })
    ).toEqual([FLAG7])
    expect(
      deriveBaselineOrangeFlags({
        unitKind: UNIT_KIND.WATERCOURSE,
        type: 'Canals',
        condition: 'Fairly Good'
      })
    ).toEqual([])
  })

  it.each([
    { type: 'Watercourse footprint', broadType: 'Watercourse footprint' },
    { type: 'Watercourse footprint' },
    {
      type: 'Watercourse footprint - Watercourse footprint',
      broadType: 'Watercourse footprint'
    }
  ])('raises FLAG10 for a watercourse footprint %j', (habitatType) => {
    expect(
      deriveBaselineOrangeFlags({
        unitKind: UNIT_KIND.AREA,
        ...habitatType,
        condition: 'Condition Assessment N/A'
      })
    ).toEqual([FLAG10])
  })

  it('raises nothing for an ordinary habitat', () => {
    expect(
      deriveBaselineOrangeFlags({
        unitKind: UNIT_KIND.HEDGEROW,
        type: 'Native hedgerow',
        condition: 'Fairly Good'
      })
    ).toEqual([])
  })
})
