import { describe, test, expect } from 'vitest'

import { distinctivenessByHabitatType } from './habitat-distinctiveness.js'
import { conditionPatternByHabitatType } from './habitat-reference.js'

describe('habitat reference data integrity', () => {
  test('every habitat type in the distinctiveness table has a condition pattern', () => {
    for (const key of Object.keys(distinctivenessByHabitatType)) {
      expect(conditionPatternByHabitatType[key], key).toBeDefined()
    }
  })

  test('every habitat type in the condition table has a distinctiveness band', () => {
    for (const key of Object.keys(conditionPatternByHabitatType)) {
      expect(distinctivenessByHabitatType[key], key).toBeDefined()
    }
  })
})
