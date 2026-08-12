import { describe, expect, it } from 'vitest'

import { makeEnhancedHabitat } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-units.fixtures.js'
import { recomputePostInterventionAreaHabitat } from './recompute-post-intervention-area-habitat.js'

describe('recomputePostInterventionAreaHabitat', () => {
  it('recomputes units and proposed display fields for an Enhanced edit', () => {
    const existing = makeEnhancedHabitat()

    const result = recomputePostInterventionAreaHabitat(existing, {
      broadType: 'Grassland',
      habitatType: 'Lowland meadows',
      condition: 'Good'
    })

    expect(result.status).toBe('Complete')
    expect(typeof result.units).toBe('number')
    expect(typeof result.distinctiveness).toBe('string')
    expect(typeof result.distinctivenessScore).toBe('number')
    expect(typeof result.conditionScore).toBe('number')
    expect(typeof result.timeMultiplier).toBe('number')
    expect(typeof result.difficultyMultiplier).toBe('number')
    expect(typeof result.standardTimeToTargetCondition).toBe('string')
    expect(typeof result.difficulty).toBe('string')
    expect(typeof result.advanceOrDelay).toBe('string')
    expect(typeof result.finalTimeToTargetCondition).toBe('string')
    expect(result.updatedFeature.proposed.type).toBe('Lowland meadows')
    expect(result.updatedFeature.proposed.broadType).toBe('Grassland')
  })

  it('fills missing proposed fields with null when enrichment cannot complete', () => {
    const existing = makeEnhancedHabitat()

    const result = recomputePostInterventionAreaHabitat(existing, {
      broadType: null,
      habitatType: null,
      condition: null
    })

    expect(result.status).toBe('Incomplete')
    expect(result.units).toBeNull()
    expect(result.distinctiveness).toBeNull()
    expect(result.distinctivenessScore).toBeNull()
    expect(result.conditionScore).toBeNull()
    expect(result.timeMultiplier).toBeNull()
    expect(result.difficultyMultiplier).toBeNull()
    expect(result.standardTimeToTargetCondition).toBeNull()
    expect(result.difficulty).toBeNull()
    expect(result.advanceOrDelay).toBeNull()
    expect(result.finalTimeToTargetCondition).toBeNull()
  })
})
