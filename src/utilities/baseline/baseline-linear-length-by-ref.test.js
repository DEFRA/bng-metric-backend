import { describe, expect, it } from 'vitest'

import {
  buildBaselineLinearLengthByRef,
  linearLengthKmFromSizeMetres,
  lookupBaselineLinearLength
} from './baseline-linear-length-by-ref.js'

describe('linearLengthKmFromSizeMetres', () => {
  it('rounds sizeMetres before converting to kilometres', () => {
    expect(linearLengthKmFromSizeMetres(1000.4)).toBe(1)
    expect(linearLengthKmFromSizeMetres(1000.6)).toBe(1.001)
  })
})

describe('buildBaselineLinearLengthByRef', () => {
  it('includes hedgerows and watercourses keyed by parcel ref', () => {
    const map = buildBaselineLinearLengthByRef(
      [{ ref: 'H1', sizeMetres: 1000 }],
      [{ ref: 'R1', sizeMetres: 2000 }]
    )

    expect(map.get('H1')).toBe(1)
    expect(map.get('R1')).toBe(2)
  })
})

describe('lookupBaselineLinearLength', () => {
  it('throws when the map is missing', () => {
    expect(() =>
      lookupBaselineLinearLength('R1', undefined, 'watercourse')
    ).toThrow(/no baseline data was provided/)
  })

  it('throws when the ref is absent from the map', () => {
    expect(() =>
      lookupBaselineLinearLength('R1', new Map(), 'watercourse')
    ).toThrow(/no baseline watercourse found/)
  })
})
