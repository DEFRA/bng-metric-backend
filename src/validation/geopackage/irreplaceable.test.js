import { describe, expect, it } from 'vitest'

import {
  irreplaceableField,
  irreplaceableFromProps,
  markedNotIrreplaceable
} from './irreplaceable.js'

const COLUMN = 'Irreplaceable Habitat'

describe('irreplaceableFromProps', () => {
  it.each([
    ['Yes', true],
    [' yes ', true],
    ['No', false],
    ['', false],
    ['   ', false],
    [null, false]
  ])('reads %j as %s', (value, expected) => {
    expect(irreplaceableFromProps({ [COLUMN]: value })).toBe(expected)
  })

  it('is undefined for a file with no such column, as a legacy file has none', () => {
    expect(irreplaceableFromProps({ 'Parcel Ref': 'H001' })).toBeUndefined()
    expect(irreplaceableFromProps(undefined)).toBeUndefined()
  })
})

describe('irreplaceableField', () => {
  it('gives the status to spread onto a feature, or nothing', () => {
    expect(irreplaceableField({ [COLUMN]: 'Yes' })).toEqual({
      irreplaceable: true
    })
    expect(irreplaceableField({})).toEqual({})
  })
})

describe('markedNotIrreplaceable', () => {
  it.each(['No', 'no', '  NO '])('is true for %j', (value) => {
    expect(markedNotIrreplaceable({ 'Irreplaceable Habitat': value })).toBe(
      true
    )
  })

  it.each(['Yes', '', '   ', null, 'Unknown', 0])(
    'is false for %j',
    (value) => {
      expect(markedNotIrreplaceable({ 'Irreplaceable Habitat': value })).toBe(
        false
      )
    }
  )

  it('is undefined for a file with no Irreplaceable Habitat column', () => {
    expect(markedNotIrreplaceable({ fid: 1 })).toBeUndefined()
  })
})
