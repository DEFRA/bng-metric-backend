import { describe, expect, it } from 'vitest'

import { featureUuidField, parentUuidField } from './template-ids.js'

const UUID = '5fdcf691-8d65-50aa-aa03-aac3f95a38a9'

describe.each([
  ['featureUuidField', featureUuidField, 'feature_uuid', 'featureUuid'],
  ['parentUuidField', parentUuidField, 'parent_uuid', 'parentUuid']
])('%s', (_, field, column, key) => {
  it('names the id the file gives, trimmed', () => {
    expect(field({ [column]: ` ${UUID} ` })).toEqual({ [key]: UUID })
  })

  it.each([null, '', '   '])('gives null for a blank cell (%j)', (value) => {
    expect(field({ [column]: value })).toEqual({ [key]: null })
  })

  it('gives nothing to spread for a file with no such column, as a legacy file has none', () => {
    expect(field({ 'Parcel Ref': 'H001' })).toEqual({})
    expect(field(undefined)).toEqual({})
  })
})
