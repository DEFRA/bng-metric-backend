import { describe, expect, it } from 'vitest'

import {
  buildFeatureIdByRef,
  normaliseRef,
  refLookupKey,
  RED_LINE_KEY
} from './carry-forward-feature-ids.js'

const ID_1 = '11111111-1111-4111-8111-111111111111'
const ID_2 = '22222222-2222-4222-8222-222222222222'
const ID_3 = '33333333-3333-4333-8333-333333333333'
const RED_LINE_ID = '44444444-4444-4444-8444-444444444444'

describe('#normaliseRef', () => {
  it('trims to a comparable string', () => {
    expect(normaliseRef('  PR-1 ')).toBe('PR-1')
  })

  it('stringifies numeric refs so both sides compare alike', () => {
    expect(normaliseRef(12)).toBe('12')
  })

  it.each([null, undefined, '', '   '])('treats %o as absent', (value) => {
    expect(normaliseRef(value)).toBeNull()
  })

  // Stringifying these would collapse every one of them onto a single lookup
  // key and match unrelated features to each other.
  it.each([{}, { a: 1 }, [], true, () => null])(
    'refuses the non-scalar %o rather than stringifying it',
    (value) => {
      expect(normaliseRef(value)).toBeNull()
    }
  )
})

describe('#buildFeatureIdByRef', () => {
  it('returns an empty map when nothing is stored yet', () => {
    expect(buildFeatureIdByRef(undefined).size).toBe(0)
    expect(buildFeatureIdByRef(null).size).toBe(0)
  })

  it('maps each layer ref to its featureId', () => {
    const map = buildFeatureIdByRef({
      habitats: [{ ref: 'PR-1', featureId: ID_1 }],
      hedgerows: [{ ref: 'HR-1', featureId: ID_2 }],
      trees: [{ ref: 'TR-1', featureId: ID_3 }]
    })

    expect(map.get(refLookupKey('habitats', 'PR-1'))).toBe(ID_1)
    expect(map.get(refLookupKey('hedgerows', 'HR-1'))).toBe(ID_2)
    expect(map.get(refLookupKey('trees', 'TR-1'))).toBe(ID_3)
  })

  it('keys refs per layer, so the same ref in two layers does not collide', () => {
    const map = buildFeatureIdByRef({
      habitats: [{ ref: 'X-1', featureId: ID_1 }],
      watercourses: [{ ref: 'X-1', featureId: ID_2 }]
    })

    expect(map.get(refLookupKey('habitats', 'X-1'))).toBe(ID_1)
    expect(map.get(refLookupKey('watercourses', 'X-1'))).toBe(ID_2)
  })

  it('skips features with a blank or missing ref', () => {
    const map = buildFeatureIdByRef({
      habitats: [
        { ref: '', featureId: ID_1 },
        { ref: null, featureId: ID_2 },
        { featureId: ID_3 }
      ]
    })

    expect(map.size).toBe(0)
  })

  it('skips features with no featureId', () => {
    const map = buildFeatureIdByRef({
      habitats: [{ ref: 'PR-1' }]
    })

    expect(map.size).toBe(0)
  })

  // A ref carried by two stored features cannot say which one owns the id, so
  // neither is offered for reuse and both re-key on the next upload.
  it('drops a ref that appears on more than one stored feature', () => {
    const map = buildFeatureIdByRef({
      habitats: [
        { ref: 'DUP', featureId: ID_1 },
        { ref: 'DUP', featureId: ID_2 },
        { ref: 'PR-9', featureId: ID_3 }
      ]
    })

    expect(map.has(refLookupKey('habitats', 'DUP'))).toBe(false)
    expect(map.get(refLookupKey('habitats', 'PR-9'))).toBe(ID_3)
  })

  it('carries the red line featureId under its own key, with no ref', () => {
    const map = buildFeatureIdByRef({
      redLine: { featureId: RED_LINE_ID, siteName: 'Greenfield' }
    })

    expect(map.get(RED_LINE_KEY)).toBe(RED_LINE_ID)
  })

  it('ignores a null red line', () => {
    expect(buildFeatureIdByRef({ redLine: null }).has(RED_LINE_KEY)).toBe(false)
  })

  it('tolerates layers that are absent or not arrays', () => {
    const map = buildFeatureIdByRef({
      habitats: [{ ref: 'PR-1', featureId: ID_1 }],
      hedgerows: null,
      watercourses: 'not an array'
    })

    expect(map.size).toBe(1)
  })

  it('normalises stored refs, so whitespace does not break a match', () => {
    const map = buildFeatureIdByRef({
      habitats: [{ ref: ' PR-1 ', featureId: ID_1 }]
    })

    expect(map.get(refLookupKey('habitats', 'PR-1'))).toBe(ID_1)
  })
})
