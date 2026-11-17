import { describe, expect, test } from 'vitest'

import { renameClashes } from './ref-in-use.js'

const baseline = {
  habitats: [
    { featureId: 'a1', ref: 'A1' },
    { featureId: 'a2', ref: 'A2' }
  ],
  hedgerows: [{ featureId: 'h1', ref: 'H1' }],
  watercourses: [{ featureId: 'w1', ref: 'W1' }]
}

describe('renameClashes', () => {
  test('clashes with another area habitat carrying the reference', () => {
    expect(
      renameClashes(baseline, {
        layer: 'habitats',
        current: 'A1',
        next: 'A2',
        exceptFeatureId: 'a1'
      })
    ).toBe(true)
  })

  test('compares references as they are stored: trimmed', () => {
    expect(
      renameClashes(baseline, {
        layer: 'habitats',
        current: 'A1',
        next: '  A2 ',
        exceptFeatureId: 'a1'
      })
    ).toBe(true)
  })

  test.each([
    ['hedgerow onto a watercourse', 'hedgerows', 'H1', 'W1', 'h1'],
    ['watercourse onto a hedgerow', 'watercourses', 'W1', 'H1', 'w1']
  ])(
    'treats hedgerows and watercourses as one layer: %s',
    (_label, layer, current, next, exceptFeatureId) => {
      expect(
        renameClashes(baseline, { layer, current, next, exceptFeatureId })
      ).toBe(true)
    }
  )

  test('does not compare area habitats with linear habitats', () => {
    expect(
      renameClashes(baseline, {
        layer: 'habitats',
        current: 'A1',
        next: 'H1',
        exceptFeatureId: 'a1'
      })
    ).toBe(false)
  })

  test('allows a reference no other habitat carries', () => {
    expect(
      renameClashes(baseline, {
        layer: 'habitats',
        current: 'A1',
        next: 'A3',
        exceptFeatureId: 'a1'
      })
    ).toBe(false)
  })

  test('never clashes when the reference is kept, even one an import shared', () => {
    const shared = {
      habitats: [
        { featureId: 'a1', ref: 'A1' },
        { featureId: 'a2', ref: 'A1' }
      ]
    }
    expect(
      renameClashes(shared, {
        layer: 'habitats',
        current: ' A1',
        next: 'A1',
        exceptFeatureId: 'a1'
      })
    ).toBe(false)
  })

  test('ignores the feature being renamed', () => {
    expect(
      renameClashes(baseline, {
        layer: 'habitats',
        current: 'P-A1',
        next: 'A1',
        exceptFeatureId: 'a1'
      })
    ).toBe(false)
  })

  test('says nothing clashes when there is no new reference or no baseline', () => {
    expect(renameClashes(baseline, { layer: 'habitats', current: 'A1' })).toBe(
      false
    )
    expect(
      renameClashes(undefined, { layer: 'habitats', current: 'A1', next: 'A2' })
    ).toBe(false)
  })

  test('checks an unlisted layer against itself', () => {
    expect(
      renameClashes(
        { trees: [{ featureId: 't1', ref: 'T1' }] },
        { layer: 'trees', current: 'T2', next: 'T1' }
      )
    ).toBe(true)
  })
})
