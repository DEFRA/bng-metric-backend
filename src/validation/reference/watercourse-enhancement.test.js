import { describe, test, expect } from 'vitest'
import { calculateEnhancedWatercoursePostIntervention } from 'bng-library/metric'
import {
  _watercourseEnhancementCacheSize,
  getWatercourseEnhancementReference
} from './watercourse-enhancement.js'
import { getWatercourseCreationReference } from './watercourse-creation.js'
import { checkFeatureEnhancement } from '../geopackage/post-intervention/enhancement-rules.js'
import { getWatercourseEnhancement } from '../../routes/reference.js'

// Each habitat type the reference offers, with its target conditions as
// condition:years.
const offered = (reference) =>
  Object.fromEntries(
    reference.habitatTypes.map((t) => [
      t.name,
      t.conditions.map((c) => `${c.condition}:${c.years}`)
    ])
  )

const UPLIFT = [
  'Good:10',
  'Fairly Good:10',
  'Moderate:10',
  'Fairly Poor:10',
  'Poor:10'
]

// BMD-1047's test data: the MVS watercourse baselines and the valid
// enhancements each is offered, with their standard time to target.
const SAME_HABITAT = {
  Poor: ['Good:8', 'Fairly Good:6', 'Moderate:4', 'Fairly Poor:2'],
  'Fairly Poor': ['Good:6', 'Fairly Good:4', 'Moderate:2'],
  Moderate: ['Good:4', 'Fairly Good:2'],
  'Fairly Good': ['Good:2']
}

describe('BMD-1047 watercourse enhancement reference', () => {
  test.each(
    ['Ditches', 'Canals'].flatMap((type) =>
      Object.entries(SAME_HABITAT).map(([condition, targets]) => [
        type,
        condition,
        targets
      ])
    )
  )(
    'a Medium %s baseline in %s condition keeps its habitat type and is offered only better conditions',
    (type, condition, targets) => {
      expect(
        offered(getWatercourseEnhancementReference({ type, condition }))
      ).toEqual({ [type]: targets })
    }
  )

  test('a Culvert baseline is offered every condition of either Medium watercourse, at 10 years', () => {
    expect(
      offered(
        getWatercourseEnhancementReference({
          type: 'Culvert',
          condition: 'Poor'
        })
      )
    ).toEqual({ Canals: UPLIFT, Ditches: UPLIFT })
  })

  test('offers the ticket’s 30 valid enhancements across the 9 enhanceable baselines', () => {
    const baselines = [
      ...['Ditches', 'Canals'].flatMap((type) =>
        Object.keys(SAME_HABITAT).map((condition) => ({ type, condition }))
      ),
      { type: 'Culvert', condition: 'Poor' }
    ]
    const count = baselines
      .flatMap((b) => getWatercourseEnhancementReference(b).habitatTypes)
      .reduce((sum, t) => sum + t.conditions.length, 0)
    expect(count).toBe(30)
  })

  test.each([
    ['Ditches', 'Good'],
    ['Canals', 'Good']
  ])(
    'is empty for %s in %s condition, which cannot be enhanced',
    (type, condition) => {
      expect(
        getWatercourseEnhancementReference({ type, condition }).habitatTypes
      ).toEqual([])
    }
  )

  test('never offers Culvert as the enhanced habitat type', () => {
    for (const condition of Object.keys(SAME_HABITAT)) {
      for (const type of ['Ditches', 'Canals']) {
        expect(
          Object.keys(
            offered(getWatercourseEnhancementReference({ type, condition }))
          )
        ).not.toContain('Culvert')
      }
    }
  })

  test('every target it offers is a valid enhancement on import', () => {
    const baseline = { type: 'Culvert', condition: 'Poor' }
    for (const type of getWatercourseEnhancementReference(baseline)
      .habitatTypes) {
      for (const { condition } of type.conditions) {
        expect(
          checkFeatureEnhancement('watercourses', {
            baseline,
            proposed: { type: type.name, condition }
          })
        ).toMatchObject({ valid: true })
      }
    }
  })

  test('carries each type the metric’s enhancement difficulty', () => {
    const baseline = { type: 'Ditches', condition: 'Moderate' }
    const [ditches] = getWatercourseEnhancementReference(baseline).habitatTypes
    const metric = calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Ditches',
      'Ditches',
      'Moderate',
      'Good',
      {
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment'
      }
    )
    expect(ditches).toMatchObject({
      difficulty: metric.difficulty,
      difficultyMultiplier: metric.difficultyMultiplier
    })
  })

  test('offers every encroachment, and the creation reference significance and multipliers', () => {
    const reference = getWatercourseEnhancementReference({
      type: 'Ditches',
      condition: 'Poor'
    })
    const creation = getWatercourseCreationReference()
    expect(reference.featureType).toBe('watercourse')
    expect(reference).toMatchObject({
      strategicSignificance: creation.strategicSignificance,
      timeMultipliers: creation.timeMultipliers,
      watercourseEncroachment: creation.watercourseEncroachment,
      riparianEncroachment: creation.riparianEncroachment
    })
    // A baseline that cannot be enhanced is still offered the other lists.
    expect(
      getWatercourseEnhancementReference({ type: 'Ditches', condition: 'Good' })
    ).toMatchObject({
      habitatTypes: [],
      watercourseEncroachment: creation.watercourseEncroachment
    })
  })

  test('a baseline the rules cannot read is offered nothing and not cached', () => {
    const before = _watercourseEnhancementCacheSize()
    for (const unread of [
      {},
      { type: 'Nope', condition: 'Poor' },
      { type: 'Ditches', condition: 'Not a condition' },
      { type: 'Ditches', condition: null }
    ]) {
      expect(getWatercourseEnhancementReference(unread).habitatTypes).toEqual(
        []
      )
    }
    expect(_watercourseEnhancementCacheSize()).toBe(before)
  })

  test('callers cannot mutate the cached reference', () => {
    const baseline = { type: 'Ditches', condition: 'Poor' }
    getWatercourseEnhancementReference(baseline).habitatTypes.length = 0
    getWatercourseEnhancementReference(
      baseline
    ).watercourseEncroachment.length = 0
    const again = getWatercourseEnhancementReference(baseline)
    expect(again.habitatTypes.length).toBeGreaterThan(0)
    expect(again.watercourseEncroachment.length).toBeGreaterThan(0)
  })

  test('the route reads the baseline from the query', () => {
    const baseline = { type: 'Culvert', condition: 'Poor' }
    expect(getWatercourseEnhancement.handler({ query: baseline }, {})).toEqual(
      getWatercourseEnhancementReference(baseline)
    )
  })
})
