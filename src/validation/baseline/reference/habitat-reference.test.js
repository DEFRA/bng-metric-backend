import { describe, test, expect } from 'vitest'

import { distinctivenessByHabitatType } from './habitat-distinctiveness.js'
import { getConditionsForHabitatType } from './habitat-reference.js'

describe('habitat reference data integrity', () => {
  test('every habitat type in the distinctiveness table has condition options', () => {
    for (const key of Object.keys(distinctivenessByHabitatType)) {
      const conditions = getConditionsForHabitatType(key)
      expect(conditions.length, key).toBeGreaterThan(0)
    }
  })
})
