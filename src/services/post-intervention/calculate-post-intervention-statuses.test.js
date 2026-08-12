import { describe, it, expect } from 'vitest'

import {
  postInterventionAreaStatus,
  postInterventionHedgerowStatus,
  postInterventionWatercourseStatus
} from './calculate-post-intervention-statuses.js'

describe.each([
  ['postInterventionAreaStatus', postInterventionAreaStatus],
  ['postInterventionHedgerowStatus', postInterventionHedgerowStatus],
  ['postInterventionWatercourseStatus', postInterventionWatercourseStatus]
])('%s with no proposed sub-object', (_name, status) => {
  it('returns Incomplete rather than throwing', () => {
    expect(status({})).toBe('Incomplete')
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

  it.each([
    { type: 'N/A', condition: 'Good' },
    { type: 'Native hedgerow', condition: 'N/A' }
  ])('returns Incomplete when only one proposed field is N/A', (proposed) => {
    expect(postInterventionHedgerowStatus({ proposed })).toBe('Incomplete')
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
