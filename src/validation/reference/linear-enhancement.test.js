import { describe, test, expect, vi } from 'vitest'
import {
  BaselineLookupError,
  MAX_YEARS_PLUS,
  OVER_MAX_YEARS
} from 'bng-library/metric'
import {
  enhancementTarget,
  readWatercourseSide
} from '../geopackage/post-intervention/enhancement-rules.js'
import {
  getConditionsForWatercourseType,
  getWatercourseHabitatTypes
} from './habitat-reference.js'
import { buildLinearEnhancementReference } from './linear-enhancement.js'

vi.mock(
  '../geopackage/post-intervention/enhancement-rules.js',
  async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, enhancementTarget: vi.fn(actual.enhancementTarget) }
  }
)

const METRICS = { difficulty: 'Low', difficultyMultiplier: 1 }
const CULVERT_POOR = { type: 'Culvert', condition: 'Poor' }

// The builder over the real watercourse rules, with the metric's calculation
// injected, so a test can make it refuse a move.
function reference(calculate) {
  return buildLinearEnhancementReference({
    layer: 'watercourses',
    featureType: 'watercourse',
    types: getWatercourseHabitatTypes,
    conditions: getConditionsForWatercourseType,
    readSide: readWatercourseSide,
    calculate
  })
}

describe('buildLinearEnhancementReference', () => {
  test('leaves out a move the metric refuses with a BaselineLookupError', () => {
    const { habitatTypes } = reference((_bt, type, _bc, condition) => {
      if (type === 'Canals' || condition === 'Good') {
        throw new BaselineLookupError('refused')
      }
      return METRICS
    }).get(CULVERT_POOR)
    expect(habitatTypes.map((t) => t.name)).toEqual(['Ditches'])
    expect(habitatTypes[0].conditions.map((c) => c.condition)).not.toContain(
      'Good'
    )
  })

  test('lets any other error from the metric through', () => {
    const failing = reference(() => {
      throw new Error('metric broke')
    })
    expect(() => failing.get(CULVERT_POOR)).toThrow('metric broke')
  })

  test('shows a time to target over the maximum as the maximum-plus label', () => {
    vi.mocked(enhancementTarget).mockReturnValue({
      valid: true,
      timeToTarget: OVER_MAX_YEARS
    })
    const { habitatTypes } = reference(() => METRICS).get(CULVERT_POOR)
    vi.mocked(enhancementTarget).mockReset()
    expect(habitatTypes.length).toBeGreaterThan(0)
    for (const type of habitatTypes) {
      for (const { years } of type.conditions) {
        expect(years).toBe(MAX_YEARS_PLUS)
      }
    }
  })
})
