import { describe, it, expect } from 'vitest'

import {
  areaStatus,
  hedgerowStatus,
  postInterventionAreaStatus,
  postInterventionHedgerowStatus,
  postInterventionWatercourseStatus,
  watercourseStatus
} from './calculate-habitat-statuses.js'

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

describe('postInterventionAreaStatus', () => {
  it('reads proposed sub-object fields', () => {
    expect(
      postInterventionAreaStatus({
        proposed: {
          broadType: 'Grassland',
          type: 'Lowland meadows',
          condition: 'Good'
        }
      })
    ).toBe('Complete')
  })

  it('returns Incomplete when a proposed field is N/A', () => {
    expect(
      postInterventionAreaStatus({
        proposed: {
          broadType: 'Grassland',
          type: 'Lowland meadows',
          condition: 'N/A'
        }
      })
    ).toBe('Incomplete')
  })
})

describe('postInterventionHedgerowStatus', () => {
  it('reads proposed type and condition', () => {
    expect(
      postInterventionHedgerowStatus({
        proposed: { type: 'Native hedgerow', condition: 'Good' }
      })
    ).toBe('Complete')
  })

  it('returns Incomplete when proposed type or condition is N/A', () => {
    expect(
      postInterventionHedgerowStatus({
        proposed: { type: 'N/A', condition: 'N/A' }
      })
    ).toBe('Incomplete')
  })
})

describe('postInterventionWatercourseStatus', () => {
  it('reads proposed encroachment fields', () => {
    expect(
      postInterventionWatercourseStatus({
        proposed: {
          type: 'Ditches',
          condition: 'Good',
          riparianEncroachment: 'No Encroachment',
          watercourseEncroachment: 'No Encroachment'
        }
      })
    ).toBe('Complete')
  })

  it('returns Incomplete when an encroachment field is N/A', () => {
    expect(
      postInterventionWatercourseStatus({
        proposed: {
          type: 'Ditches',
          condition: 'Good',
          riparianEncroachment: 'N/A',
          watercourseEncroachment: 'Minor'
        }
      })
    ).toBe('Incomplete')
  })
})
