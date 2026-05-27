import { describe, it, expect } from 'vitest'

import {
  HABITAT_STATUS,
  areaStatus,
  hedgerowStatus,
  watercourseStatus
} from './calculate-habitat-statuses.js'

const COMPLETE = HABITAT_STATUS.COMPLETE
const INCOMPLETE = HABITAT_STATUS.INCOMPLETE

describe('HABITAT_STATUS', () => {
  it('exports Complete and Incomplete constants', () => {
    expect(HABITAT_STATUS.COMPLETE).toBe('Complete')
    expect(HABITAT_STATUS.INCOMPLETE).toBe('Incomplete')
  })
})

describe('areaStatus — AC1 / AC4', () => {
  it('returns Complete when broadType, type and condition are all present', () => {
    expect(
      areaStatus({
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: 'Good'
      })
    ).toBe(COMPLETE)
  })

  it('returns Incomplete when broadType is missing', () => {
    expect(
      areaStatus({
        broadType: null,
        type: 'Lowland meadows',
        condition: 'Good'
      })
    ).toBe(INCOMPLETE)
  })

  it('returns Incomplete when type is missing', () => {
    expect(
      areaStatus({ broadType: 'Grassland', type: null, condition: 'Good' })
    ).toBe(INCOMPLETE)
  })

  it('returns Incomplete when condition is missing', () => {
    expect(
      areaStatus({
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: null
      })
    ).toBe(INCOMPLETE)
  })

  it('returns Incomplete when all fields are missing', () => {
    expect(areaStatus({ broadType: null, type: null, condition: null })).toBe(
      INCOMPLETE
    )
  })
})

describe('hedgerowStatus — AC2 / AC5', () => {
  it('returns Complete when type and condition are both present', () => {
    expect(
      hedgerowStatus({
        type: 'Native species rich hedgerow',
        condition: 'Good'
      })
    ).toBe(COMPLETE)
  })

  it('returns Incomplete when type is missing', () => {
    expect(hedgerowStatus({ type: null, condition: 'Good' })).toBe(INCOMPLETE)
  })

  it('returns Incomplete when condition is missing', () => {
    expect(
      hedgerowStatus({ type: 'Native species rich hedgerow', condition: null })
    ).toBe(INCOMPLETE)
  })

  it('returns Incomplete when both fields are missing', () => {
    expect(hedgerowStatus({ type: null, condition: null })).toBe(INCOMPLETE)
  })
})

describe('watercourseStatus — AC3 / AC6', () => {
  const complete = {
    type: 'Watercourse footprint - Watercourse footprint',
    condition: 'Moderate',
    riparianEncroachment: 'None',
    watercourseEncroachment: 'None'
  }

  it('returns Complete when type, condition, riparianEncroachment and watercourseEncroachment are all present', () => {
    expect(watercourseStatus(complete)).toBe(COMPLETE)
  })

  it('returns Incomplete when type is missing', () => {
    expect(watercourseStatus({ ...complete, type: null })).toBe(INCOMPLETE)
  })

  it('returns Incomplete when condition is missing', () => {
    expect(watercourseStatus({ ...complete, condition: null })).toBe(INCOMPLETE)
  })

  it('returns Incomplete when riparianEncroachment is missing', () => {
    expect(watercourseStatus({ ...complete, riparianEncroachment: null })).toBe(
      INCOMPLETE
    )
  })

  it('returns Incomplete when watercourseEncroachment is missing', () => {
    expect(
      watercourseStatus({ ...complete, watercourseEncroachment: null })
    ).toBe(INCOMPLETE)
  })

  it('returns Incomplete when all fields are missing', () => {
    expect(
      watercourseStatus({
        type: null,
        condition: null,
        riparianEncroachment: null,
        watercourseEncroachment: null
      })
    ).toBe(INCOMPLETE)
  })
})
