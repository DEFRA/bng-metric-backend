import { describe, expect, it } from 'vitest'

import {
  engineHabitatTypeCandidates,
  normalizeConditionForEngine
} from './engine-helpers.js'

describe('normalizeConditionForEngine', () => {
  it('strips leading list index from statutory condition labels', () => {
    expect(normalizeConditionForEngine('6. N/A - Other')).toBe('N/A - Other')
  })

  it('returns trimmed string when there is no index prefix', () => {
    expect(normalizeConditionForEngine('  Moderate  ')).toBe('Moderate')
  })

  it('coerces null to an empty string so engine consumers always get a string', () => {
    expect(normalizeConditionForEngine(null)).toBe('')
  })

  it('coerces undefined to an empty string so engine consumers always get a string', () => {
    expect(normalizeConditionForEngine(undefined)).toBe('')
  })
})

describe('engineHabitatTypeCandidates', () => {
  it('yields broad-prefixed key when type is not already prefixed', () => {
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: 'Developed land; sealed surface',
          broadType: 'Urban'
        })
      )
    ).toEqual([
      'Developed land; sealed surface',
      'Urban - Developed land; sealed surface'
    ])
  })

  it('yields nothing when habitat type is empty after trim', () => {
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: '',
          broadType: 'Urban'
        })
      )
    ).toEqual([])
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: '  \t',
          broadType: 'Urban'
        })
      )
    ).toEqual([])
    expect(
      Array.from(engineHabitatTypeCandidates({ broadType: 'Urban' }))
    ).toEqual([])
    expect(Array.from(engineHabitatTypeCandidates({ type: null }))).toEqual([])
  })

  it('does not duplicate when type already includes broad prefix', () => {
    expect(
      Array.from(
        engineHabitatTypeCandidates({
          type: 'Urban - Developed land; sealed surface',
          broadType: 'Urban'
        })
      )
    ).toEqual(['Urban - Developed land; sealed surface'])
  })
})
