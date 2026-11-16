import { describe, expect, test } from 'vitest'

import {
  retainedBaselineComment,
  sharesBaselineComment
} from './retained-baseline-comment.js'

// BMD-1187: a Retained habitat shows the comment saved on its baseline parcel.

const BASELINE_ID = 'aa0e8400-e29b-41d4-a716-446655440010'
const OTHER_BASELINE_ID = 'aa0e8400-e29b-41d4-a716-446655440011'

const LEGACY = { templateUpload: false }
const TEMPLATE = { templateUpload: true }

function baselineHabitat(overrides = {}) {
  return {
    featureId: BASELINE_ID,
    ref: 'A1',
    type: 'Modified grassland',
    broadType: 'Grassland',
    condition: 'Poor',
    comment: 'The baseline comment',
    ...overrides
  }
}

function retainedRow(overrides = {}) {
  return {
    featureId: 'aa0e8400-e29b-41d4-a716-446655440020',
    ref: 'A1',
    retentionCategory: 'Retained',
    baseline: {
      type: 'Modified grassland',
      broadType: 'Grassland',
      condition: 'Poor'
    },
    ...overrides
  }
}

describe('sharesBaselineComment', () => {
  test.each([
    ['a Retained feature', { retentionCategory: 'Retained' }, true],
    [
      'a feature whose Retained category an older import stored under baseline',
      { baseline: { retentionCategory: 'Retained' } },
      true
    ],
    ['an Enhanced feature', { retentionCategory: 'Enhanced' }, false],
    ['a Created feature', { retentionCategory: 'Created' }, false],
    ['a feature with no retention category', {}, false]
  ])('is %s → %s', (_, feature, expected) => {
    expect(sharesBaselineComment(feature)).toBe(expected)
  })
})

describe('retainedBaselineComment', () => {
  describe('a legacy upload, joined by ref', () => {
    test('reads the comment of the baseline feature carrying the row’s ref', () => {
      expect(
        retainedBaselineComment(
          retainedRow(),
          'habitats',
          [baselineHabitat()],
          LEGACY
        )
      ).toBe('The baseline comment')
    })

    test('matches a ref the baseline holds with surrounding spaces', () => {
      expect(
        retainedBaselineComment(
          retainedRow(),
          'habitats',
          [baselineHabitat({ ref: ' A1 ' })],
          LEGACY
        )
      ).toBe('The baseline comment')
    })

    test('keeps the line breaks the comment was saved with', () => {
      expect(
        retainedBaselineComment(
          retainedRow(),
          'habitats',
          [baselineHabitat({ comment: 'One\nTwo' })],
          LEGACY
        )
      ).toBe('One\nTwo')
    })

    test('picks the parcel the row’s imported values describe where a ref is shared', () => {
      const baseline = [
        baselineHabitat({
          featureId: OTHER_BASELINE_ID,
          condition: 'Good',
          comment: 'Another parcel'
        }),
        baselineHabitat()
      ]

      expect(
        retainedBaselineComment(retainedRow(), 'habitats', baseline, LEGACY)
      ).toBe('The baseline comment')
    })

    test('is null where the shared ref’s parcels cannot be told apart', () => {
      const baseline = [
        baselineHabitat({ featureId: OTHER_BASELINE_ID, comment: 'Another' }),
        baselineHabitat()
      ]

      expect(
        retainedBaselineComment(retainedRow(), 'habitats', baseline, LEGACY)
      ).toBeNull()
    })

    test('is null when no baseline feature carries the ref', () => {
      expect(
        retainedBaselineComment(
          retainedRow({ ref: 'Z9' }),
          'habitats',
          [baselineHabitat()],
          LEGACY
        )
      ).toBeNull()
    })

    test('is null when the baseline feature has no comment', () => {
      expect(
        retainedBaselineComment(
          retainedRow(),
          'habitats',
          [baselineHabitat({ comment: null })],
          LEGACY
        )
      ).toBeNull()
    })

    test.each([null, undefined])(
      'is null when the baseline has no such layer (%s)',
      (features) => {
        expect(
          retainedBaselineComment(retainedRow(), 'hedgerows', features, LEGACY)
        ).toBeNull()
      }
    )
  })

  describe('a BNG Service template upload, joined by parent', () => {
    test('reads the named parent’s comment whatever the refs', () => {
      const row = retainedRow({
        ref: 'PI-ref',
        parentFeatureId: BASELINE_ID,
        comment: 'Imported with the post-intervention table'
      })

      expect(
        retainedBaselineComment(
          row,
          'verticalHabitats',
          [
            baselineHabitat({
              featureId: OTHER_BASELINE_ID,
              ref: 'PI-ref',
              comment: 'Shares the row’s ref only'
            }),
            baselineHabitat({ ref: 'Baseline-ref' })
          ],
          TEMPLATE
        )
      ).toBe('The baseline comment')
    })

    test('is null when the row names no parent, even if a ref matches', () => {
      expect(
        retainedBaselineComment(
          retainedRow(),
          'habitats',
          [baselineHabitat()],
          TEMPLATE
        )
      ).toBeNull()
    })

    test('is null when the baseline no longer holds the parent', () => {
      expect(
        retainedBaselineComment(
          retainedRow({ parentFeatureId: OTHER_BASELINE_ID }),
          'habitats',
          [baselineHabitat()],
          TEMPLATE
        )
      ).toBeNull()
    })
  })
})
