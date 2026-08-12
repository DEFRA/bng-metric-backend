import { describe, expect, it } from 'vitest'

import { applyProposedResult } from './enrich-post-intervention-shared.js'

describe('applyProposedResult', () => {
  it('maps enhanced engine metrics and derived display fields onto proposed', () => {
    const feature = {
      proposed: { advanceYears: 2, delayYears: 0 },
      units: null,
      status: 'Incomplete'
    }

    applyProposedResult(feature, {
      units: 5.4,
      postInterventionDistinctiveness: 'Low',
      postInterventionDistinctivenessScore: 2,
      postInterventionConditionScore: 3,
      timeMultiplier: 0.7002822742,
      difficultyMultiplier: 1,
      standardTimeToTargetCondition: '10',
      difficulty: 'Low'
    })

    expect(feature.proposed.distinctiveness).toBe('Low')
    expect(feature.proposed.distinctivenessScore).toBe(2)
    expect(feature.proposed.conditionScore).toBe(3)
    expect(feature.proposed.standardTimeToTargetCondition).toBe('10')
    expect(feature.proposed.difficulty).toBe('Low')
    expect(feature.proposed.advanceOrDelay).toBe('Advance - 2 years')
    expect(feature.proposed.finalTimeToTargetCondition).toBe(
      '8 years (0.7002822742)'
    )
    expect(feature.units).toBe(5.4)
    expect(feature.status).toBe('Complete')
  })
})
