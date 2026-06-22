import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.js'
import { getIndividualTreeAreaHectares } from './tree.js'

describe('getIndividualTreeAreaHectares', () => {
  it.each([
    ['Small', 0.0041],
    ['Medium', 0.0163],
    ['Large', 0.0366],
    ['Very large', 0.0765]
  ])('returns the reference area for %s trees', (size, expected) => {
    expect(getIndividualTreeAreaHectares(size)).toBe(expected)
  })

  it('matches size labels case-insensitively and trims whitespace', () => {
    expect(getIndividualTreeAreaHectares('  very LARGE ')).toBe(0.0765)
    expect(getIndividualTreeAreaHectares('medium')).toBe(0.0163)
  })

  it.each([null, undefined, '', '   '])(
    'throws BaselineLookupError for empty size %p',
    (size) => {
      expect(() => getIndividualTreeAreaHectares(size)).toThrow(
        BaselineLookupError
      )
    }
  )

  it('throws BaselineLookupError for an unrecognised size', () => {
    expect(() => getIndividualTreeAreaHectares('Gigantic')).toThrow(
      BaselineLookupError
    )
  })
})
