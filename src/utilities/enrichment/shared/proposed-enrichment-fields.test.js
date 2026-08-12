import { describe, expect, it } from 'vitest'

import {
  copyProposedDisplayFields,
  copyProposedEngineMetrics
} from './proposed-enrichment-fields.js'

describe('copyProposedEngineMetrics', () => {
  it('copies only present engine metric fields', () => {
    const proposed = {}
    copyProposedEngineMetrics(proposed, {
      timeMultiplier: 0.7,
      difficultyMultiplier: 1,
      standardTimeToTargetCondition: '10',
      difficulty: 'Low',
      advanceOrDelay: 'Neither'
    })
    expect(proposed).toEqual({
      timeMultiplier: 0.7,
      difficultyMultiplier: 1,
      standardTimeToTargetCondition: '10',
      difficulty: 'Low'
    })
  })
})

describe('copyProposedDisplayFields', () => {
  it('copies only present display fields', () => {
    const proposed = {}
    copyProposedDisplayFields(proposed, {
      advanceOrDelay: 'Advance - 2 years',
      finalTimeToTargetCondition: '8 years (0.7)',
      difficulty: 'Low'
    })
    expect(proposed).toEqual({
      advanceOrDelay: 'Advance - 2 years',
      finalTimeToTargetCondition: '8 years (0.7)'
    })
  })
})
