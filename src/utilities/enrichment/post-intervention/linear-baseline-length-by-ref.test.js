import { describe, expect, it } from 'vitest'

import {
  buildBaselineLinearLengthByRef,
  linearLengthKmFromSizeMetres,
  lookupBaselineLinearLength
} from './linear-baseline-length-by-ref.js'

describe('linearLengthKmFromSizeMetres', () => {
  it('converts sizeMetres to kilometres without rounding', () => {
    expect(linearLengthKmFromSizeMetres(1000.4)).toBe(1.0004)
    expect(linearLengthKmFromSizeMetres(1000.6)).toBe(1.0006)
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

describe('a baseline saved before references were cleaned (BMD-1058)', () => {
  // The post-intervention ref is the cleaned one; the stored baseline ref is
  // raw, as it was saved before references were trimmed and truncated.
  it.each([
    ['surrounded by spaces', ' H001 ', 'H001'],
    ['a number', 12, '12'],
    ['over 100 characters', `${'L'.repeat(120)}`, 'L'.repeat(100)]
  ])(
    'finds the length of a stored ref %s from the cleaned ref',
    (_, storedRef, cleanedRef) => {
      const map = buildBaselineLinearLengthByRef(
        [{ ref: storedRef, sizeMetres: 1000 }],
        []
      )

      expect(
        lookupBaselineLinearLength({ ref: cleanedRef }, map, 'hedgerow')
      ).toBe(1)
    }
  )

  it('still finds a ref saved cleaned, looked up with an uncleaned one', () => {
    const map = buildBaselineLinearLengthByRef(
      [],
      [{ ref: 'R1', sizeMetres: 2000 }]
    )

    expect(lookupBaselineLinearLength({ ref: ' R1' }, map, 'watercourse')).toBe(
      2
    )
  })

  it('leaves out a stored feature with a blank ref', () => {
    const map = buildBaselineLinearLengthByRef(
      [{ ref: '   ', sizeMetres: 1000 }],
      []
    )

    expect(map.size).toBe(0)
    expect(() =>
      lookupBaselineLinearLength({ ref: '   ' }, map, 'hedgerow')
    ).toThrow(/no baseline hedgerow found/)
  })
})

describe('lookupBaselineLinearLength', () => {
  it('throws when the map is missing', () => {
    expect(() =>
      lookupBaselineLinearLength({ ref: 'R1' }, undefined, 'watercourse')
    ).toThrow(/no baseline data was provided/)
  })

  it('throws when the ref is absent from the map', () => {
    expect(() =>
      lookupBaselineLinearLength({ ref: 'R1' }, new Map(), 'watercourse')
    ).toThrow(/no baseline watercourse found/)
  })
})

describe('a BNG Service template feature, linked to its parent (BMD-1083)', () => {
  const HEDGE_ID = '6d5f2c1e-8f43-4a8e-9b51-2a3c4d5e6f70'
  const RIVER_ID = '7e6a3d2f-9a54-4b9f-8c62-3b4d5e6f7081'
  const lengths = buildBaselineLinearLengthByRef(
    [{ ref: 'HG005', featureId: HEDGE_ID, sizeMetres: 1000 }],
    [{ ref: 'R001', featureId: RIVER_ID, sizeMetres: 2000 }]
  )

  it('is priced against its parent’s length, whatever its own ref', () => {
    expect(
      lookupBaselineLinearLength(
        { ref: 'HG005x', parentFeatureId: HEDGE_ID },
        lengths,
        'hedgerow'
      )
    ).toBe(1)
  })

  it('is never priced against another feature that shares its ref', () => {
    // A watercourse whose ref is a hedgerow's takes its own parent's length.
    expect(
      lookupBaselineLinearLength(
        { ref: 'HG005', parentFeatureId: RIVER_ID },
        lengths,
        'watercourse'
      )
    ).toBe(2)
  })

  it('throws when its parent has no measured length', () => {
    expect(() =>
      lookupBaselineLinearLength(
        {
          ref: 'R001',
          parentFeatureId: '00000000-0000-4000-8000-000000000000'
        },
        lengths,
        'watercourse'
      )
    ).toThrow(
      /no baseline watercourse found for the parent of parcel ref "R001"/
    )
  })
})
