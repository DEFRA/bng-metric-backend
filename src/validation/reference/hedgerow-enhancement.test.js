import { describe, test, expect } from 'vitest'
import { calculateEnhancedHedgerowPostIntervention } from 'bng-library/metric'
import {
  _hedgerowEnhancementCacheSize,
  getHedgerowEnhancementReference
} from './hedgerow-enhancement.js'
import { getHedgerowCreationReference } from './hedgerow-creation.js'
import { checkFeatureEnhancement } from '../geopackage/post-intervention/enhancement-rules.js'
import { getHedgerowEnhancement } from '../../routes/reference.js'

const baseline = { type: 'Native hedgerow', condition: 'Moderate' }

// Each habitat type the reference offers, with its target conditions as
// condition:years.
const offered = (reference) =>
  Object.fromEntries(
    reference.habitatTypes.map((t) => [
      t.name,
      t.conditions.map((c) => `${c.condition}:${c.years}`)
    ])
  )

describe('BMD-1046 hedgerow enhancement reference', () => {
  test('AC1: offers only valid enhancements of the baseline, with their enhancement times', () => {
    // Native hedgerow at Moderate. Native hedgerow itself is offered Good only,
    // condition to condition; a move to a more distinctive type takes the
    // metric's G-6 type-to-type time, whatever the target condition.
    expect(offered(getHedgerowEnhancementReference(baseline))).toEqual({
      'Native hedgerow': ['Good:2'],
      'Native hedgerow - associated with bank or ditch': [
        'Good:6',
        'Moderate:6'
      ],
      'Native hedgerow with trees': ['Good:10', 'Moderate:10'],
      'Species-rich native hedgerow': ['Good:5', 'Moderate:5']
    })
  })

  test('a poorer baseline is offered more target conditions', () => {
    expect(
      offered(
        getHedgerowEnhancementReference({ ...baseline, condition: 'Poor' })
      )
    ).toEqual({
      'Native hedgerow': ['Good:5', 'Moderate:3'],
      'Native hedgerow - associated with bank or ditch': [
        'Good:6',
        'Moderate:6',
        'Poor:6'
      ],
      'Native hedgerow with trees': ['Good:10', 'Moderate:10', 'Poor:10'],
      'Species-rich native hedgerow': ['Good:5', 'Moderate:5', 'Poor:5']
    })
  })

  test('every target it offers is a valid enhancement on import', () => {
    for (const type of getHedgerowEnhancementReference(baseline).habitatTypes) {
      for (const { condition } of type.conditions) {
        expect(
          checkFeatureEnhancement('hedgerows', {
            baseline,
            proposed: { type: type.name, condition }
          })
        ).toMatchObject({ valid: true })
      }
    }
  })

  test('leaves out the hedgerow type moves the metric does not allow', () => {
    const names = Object.keys(
      offered(getHedgerowEnhancementReference(baseline))
    )
    expect(names).not.toContain('Line of trees')
    expect(names).not.toContain('Ecologically valuable line of trees')
  })

  test('carries each type its enhancement difficulty and the creation reference significance and multipliers', () => {
    const reference = getHedgerowEnhancementReference(baseline)
    expect(reference.featureType).toBe('hedgerow')
    for (const type of reference.habitatTypes) {
      expect(type.difficulty).toEqual(expect.any(String))
      expect(type.difficultyMultiplier).toEqual(expect.any(Number))
    }
    const creation = getHedgerowCreationReference()
    expect(reference.strategicSignificance).toEqual(
      creation.strategicSignificance
    )
    expect(reference.timeMultipliers).toEqual(creation.timeMultipliers)
  })

  test.each([
    ['a condition change', 'Native hedgerow', 'Good'],
    ['a habitat type change', 'Species-rich native hedgerow', 'Moderate']
  ])(
    'carries the metric’s enhancement difficulty for %s',
    (_change, type, condition) => {
      const offered = getHedgerowEnhancementReference(
        baseline
      ).habitatTypes.find((t) => t.name === type)
      const metric = calculateEnhancedHedgerowPostIntervention(
        1,
        1,
        baseline.type,
        type,
        baseline.condition,
        condition
      )
      expect(offered).toMatchObject({
        difficulty: metric.difficulty,
        difficultyMultiplier: metric.difficultyMultiplier
      })
      expect(offered.conditions).toContainEqual(
        expect.objectContaining({
          condition,
          years: Number(metric.standardTimeToTargetCondition)
        })
      )
    }
  )

  test('is empty for a baseline that cannot be enhanced', () => {
    expect(
      getHedgerowEnhancementReference({
        type: 'Species-rich native hedgerow',
        condition: 'Good'
      }).habitatTypes
    ).toEqual([])
  })

  test('a baseline the rules cannot read is offered nothing and not cached', () => {
    const before = _hedgerowEnhancementCacheSize()
    for (const unread of [
      {},
      { type: 'Nope', condition: 'Poor' },
      { ...baseline, condition: 'Not a condition' },
      { ...baseline, condition: null }
    ]) {
      expect(getHedgerowEnhancementReference(unread).habitatTypes).toEqual([])
    }
    expect(_hedgerowEnhancementCacheSize()).toBe(before)
  })

  test('the same baseline read two ways shares one cached answer', () => {
    const expected = getHedgerowEnhancementReference(baseline)
    const size = _hedgerowEnhancementCacheSize()
    expect(
      getHedgerowEnhancementReference({ ...baseline, condition: '2. Moderate' })
    ).toEqual(expected)
    expect(_hedgerowEnhancementCacheSize()).toBe(size)
  })

  test('callers cannot mutate the cached reference', () => {
    getHedgerowEnhancementReference(baseline).habitatTypes.length = 0
    expect(
      getHedgerowEnhancementReference(baseline).habitatTypes.length
    ).toBeGreaterThan(0)
  })

  test('the route reads the baseline from the query', () => {
    expect(getHedgerowEnhancement.handler({ query: baseline }, {})).toEqual(
      getHedgerowEnhancementReference(baseline)
    )
  })
})
