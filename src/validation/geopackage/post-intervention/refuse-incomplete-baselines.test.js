import { describe, expect, it } from 'vitest'

import { expectDeclaredDetails } from '../../../../test/helpers/declared-details.js'
import { ERROR_CODES } from '../errors.js'
import { SAMPLE_CAP } from '../offenders.js'
import { refuseIncompleteBaselines } from './refuse-incomplete-baselines.js'

const complete = (ref, type = 'Mixed scrub') => ({
  ref,
  type,
  status: 'Complete'
})
const incomplete = (ref, type = null) => ({ ref, type, status: 'Incomplete' })

describe('refuseIncompleteBaselines (BMD-1195)', () => {
  it('passes a baseline whose area habitats, hedgerows and watercourses are all Complete', () => {
    expect(
      refuseIncompleteBaselines({
        habitats: [complete('H1')],
        hedgerows: [complete('HG1', 'Native hedgerow')],
        watercourses: [complete('R1', 'Ditches')]
      })
    ).toBeNull()
  })

  it.each([
    ['habitats', 'H1'],
    ['hedgerows', 'HG1'],
    ['watercourses', 'R1']
  ])('refuses an Incomplete feature in %s', (layer, ref) => {
    const error = refuseIncompleteBaselines({
      habitats: [complete('H0')],
      [layer]: [complete(`${ref}-ok`), incomplete(ref, 'Some type')]
    })

    expect(error).toEqual({
      code: ERROR_CODES.BASELINE_HABITATS_INCOMPLETE,
      message: `One or more baseline habitats are incomplete, so this post-intervention file cannot replace the project baseline: Feature Ref ${ref}`,
      details: {
        count: 1,
        sample: [{ layer, idx: 1, feature_ref: ref, habitat_type: 'Some type' }]
      }
    })
    expectDeclaredDetails(error)
  })

  it('names every incomplete habitat in one error, across layers', () => {
    const error = refuseIncompleteBaselines({
      habitats: [incomplete('H1')],
      hedgerows: [incomplete('HG1')],
      watercourses: [incomplete('R1')]
    })

    expect(error.details.count).toBe(3)
    expect(error.details.sample.map((s) => s.feature_ref)).toEqual([
      'H1',
      'HG1',
      'R1'
    ])
    expect(error.message).toMatch(
      /Feature Ref H1, Feature Ref HG1, Feature Ref R1$/
    )
  })

  it('names a habitat with no ref by its layer and fid', () => {
    const error = refuseIncompleteBaselines({
      habitats: [{ ...incomplete(null), properties: { fid: 7 } }]
    })

    expect(error.details.sample).toEqual([
      {
        layer: 'habitats',
        idx: 0,
        fid: 7,
        feature_ref: null,
        habitat_type: null
      }
    ])
    expect(error.message).toMatch(/: habitats fid 7$/)
  })

  it('caps the sample, and says how many more there are', () => {
    const error = refuseIncompleteBaselines({
      habitats: Array.from({ length: SAMPLE_CAP + 2 }, (_, i) =>
        incomplete(`H${i}`)
      )
    })

    expect(error.details.count).toBe(SAMPLE_CAP + 2)
    expect(error.details.sample).toHaveLength(SAMPLE_CAP)
    expect(error.message).toMatch(/ \(and 2 more\)$/)
  })

  it('does not check vertical area habitats or trees, which the story does not name', () => {
    expect(
      refuseIncompleteBaselines({
        habitats: [complete('H1')],
        verticalHabitats: [incomplete('V1')],
        trees: [incomplete('T1')]
      })
    ).toBeNull()
  })

  it('passes a missing document or layer', () => {
    expect(refuseIncompleteBaselines(undefined)).toBeNull()
    expect(refuseIncompleteBaselines({ habitats: [complete('H1')] })).toBeNull()
  })
})
