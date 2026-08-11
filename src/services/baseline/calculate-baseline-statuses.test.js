import { describe, it, expect } from 'vitest'

import {
  areaStatus,
  hedgerowStatus,
  watercourseStatus
} from './calculate-baseline-statuses.js'

describe('areaStatus', () => {
  it('returns Complete when broad type, type and condition are set', () => {
    expect(
      areaStatus({
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: 'Good'
      })
    ).toBe('Complete')
  })

  it('returns Incomplete when a required field is missing', () => {
    expect(
      areaStatus({
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: null
      })
    ).toBe('Incomplete')
  })
})

describe('hedgerowStatus', () => {
  it('returns Complete when type and condition are set', () => {
    expect(hedgerowStatus({ type: 'Native hedgerow', condition: 'Good' })).toBe(
      'Complete'
    )
  })

  it('returns Incomplete when condition is missing', () => {
    expect(hedgerowStatus({ type: 'Native hedgerow', condition: null })).toBe(
      'Incomplete'
    )
  })
})

describe('watercourseStatus', () => {
  it('returns Complete when all required fields are set', () => {
    expect(
      watercourseStatus({
        type: 'Ditches',
        condition: 'Good',
        riparianEncroachment: 'No Encroachment',
        watercourseEncroachment: 'No Encroachment'
      })
    ).toBe('Complete')
  })

  it('returns Incomplete when encroachment is missing', () => {
    expect(
      watercourseStatus({
        type: 'Ditches',
        condition: 'Good',
        riparianEncroachment: null,
        watercourseEncroachment: 'No Encroachment'
      })
    ).toBe('Incomplete')
  })
})
