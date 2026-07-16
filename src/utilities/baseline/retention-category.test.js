import { describe, expect, it } from 'vitest'

import {
  deriveRetentionCategory,
  isLegacyLostLinear,
  isLostLinearRetention,
  normaliseRetentionCategory,
  resolveRetentionCategory
} from './retention-category.js'

describe('retention-category', () => {
  it('normalises numeric list prefixes from GPKG values', () => {
    expect(normaliseRetentionCategory('1. Created')).toBe('Created')
  })

  it('maps Retained, Created, and Enhanced verbatim', () => {
    expect(deriveRetentionCategory('Retained')).toBe('Retained')
    expect(deriveRetentionCategory('Created')).toBe('Created')
    expect(deriveRetentionCategory('Enhanced')).toBe('Enhanced')
  })

  it('maps GPKG Lost to Created for area habitats and trees', () => {
    expect(deriveRetentionCategory('Lost')).toBe('Created')
    expect(deriveRetentionCategory('4. Lost')).toBe('Created')
  })

  it('returns null for missing or unrecognised GPKG values', () => {
    expect(deriveRetentionCategory(null)).toBeNull()
    expect(deriveRetentionCategory('Partial')).toBeNull()
  })

  it('detects Lost linear retention for extract filtering', () => {
    expect(isLostLinearRetention('Lost')).toBe(true)
    expect(isLostLinearRetention('Created')).toBe(false)
  })

  it('prefers top-level retentionCategory when resolving for enrichment', () => {
    expect(
      resolveRetentionCategory({
        retentionCategory: 'Enhanced',
        baseline: { retentionCategory: 'Retained' }
      })
    ).toBe('Enhanced')
  })

  it('derives from legacy baseline.retentionCategory when top-level field is absent', () => {
    expect(
      resolveRetentionCategory({
        baseline: { retentionCategory: '1. Retained' }
      })
    ).toBe('Retained')
  })

  it('returns null when neither top-level nor baseline retention is present', () => {
    expect(resolveRetentionCategory({})).toBeNull()
    expect(resolveRetentionCategory({ baseline: {} })).toBeNull()
    expect(resolveRetentionCategory(null)).toBeNull()
    expect(resolveRetentionCategory(undefined)).toBeNull()
  })

  it('ignores an unrecognised top-level value and falls back to baseline', () => {
    expect(
      resolveRetentionCategory({
        retentionCategory: 'Partial',
        baseline: { retentionCategory: 'Enhanced' }
      })
    ).toBe('Enhanced')
  })

  describe('isLegacyLostLinear', () => {
    it('is true only for legacy features with baseline Lost and no top-level category', () => {
      expect(
        isLegacyLostLinear({ baseline: { retentionCategory: 'Lost' } })
      ).toBe(true)
      expect(
        isLegacyLostLinear({ baseline: { retentionCategory: '4. Lost' } })
      ).toBe(true)
    })

    it('is false once a top-level retentionCategory is present', () => {
      expect(
        isLegacyLostLinear({
          retentionCategory: 'Created',
          baseline: { retentionCategory: 'Lost' }
        })
      ).toBe(false)
    })

    it('is false for non-Lost or missing baseline retention', () => {
      expect(
        isLegacyLostLinear({ baseline: { retentionCategory: 'Retained' } })
      ).toBe(false)
      expect(isLegacyLostLinear({ baseline: {} })).toBe(false)
      expect(isLegacyLostLinear({})).toBe(false)
      expect(isLegacyLostLinear(null)).toBe(false)
    })
  })
})
