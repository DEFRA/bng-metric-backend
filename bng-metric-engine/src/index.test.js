import { describe, expect, it } from 'vitest'

import * as pkg from './index.js'

describe('bng-metric-engine public exports', () => {
  it('re-exports reference tables and baseline helpers', () => {
    expect(pkg.calculateAreaHabitatBaseline).toBeTypeOf('function')
    expect(pkg.calculateHedgerowBaseline).toBeTypeOf('function')
    expect(pkg.calculateWatercourseBaseline).toBeTypeOf('function')
    expect(pkg.isRecognisedEncroachmentValue).toBeTypeOf('function')
    expect(pkg.WATERCOURSE_ENCROACHMENT_MULTIPLIER).toBeTypeOf('object')
    expect(pkg.WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER).toBeTypeOf(
      'object'
    )
    expect(pkg.resolveDistinctiveness).toBeTypeOf('function')
    expect(pkg.BaselineLookupError).toBeTypeOf('function')
    expect(pkg.roundToSigFigs).toBeTypeOf('function')
    expect(pkg.MAX_SIG_FIGS).toBe(15)
    expect(pkg.CONDITION_SCORES).toBeTypeOf('object')
    expect(pkg.DIFFICULTY_MULTIPLIER).toBeTypeOf('object')
    expect(pkg.DISTINCTIVENESS_CATEGORIES).toBeTypeOf('object')
    expect(pkg.DISTINCTIVENESS_SCORES).toBeTypeOf('object')
    expect(pkg.HABITAT_DIFFICULTY).toBeTypeOf('object')
    expect(pkg.TIME_TO_TARGET_CREATION).toBeTypeOf('object')
    expect(pkg.TIME_TO_TARGET_ENHANCEMENT).toBeTypeOf('object')
    expect(pkg.TIME_TO_TARGET_MULTIPLIER).toBeTypeOf('object')
  })
})
