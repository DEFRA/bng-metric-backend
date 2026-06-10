import { describe, expect, it } from 'vitest'

import { stripConditionPrefix } from './condition.js'

describe('stripConditionPrefix', () => {
  it('strips a single-digit "N. " prefix', () => {
    expect(stripConditionPrefix('3. Moderate')).toBe('Moderate')
  })

  it('strips a double-digit "N. " prefix', () => {
    expect(stripConditionPrefix('10. Some Condition')).toBe('Some Condition')
  })

  it('returns the trimmed string unchanged when no prefix is present', () => {
    expect(stripConditionPrefix('  Moderate  ')).toBe('Moderate')
  })

  it('preserves null so absent conditions stay absent in the JSONB document', () => {
    expect(stripConditionPrefix(null)).toBeNull()
  })

  it('preserves undefined so absent conditions stay absent', () => {
    expect(stripConditionPrefix(undefined)).toBeUndefined()
  })
})
