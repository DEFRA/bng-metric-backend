import { describe, it, expect } from 'vitest'

import { assignFeatureIds } from './assign-feature-ids.js'
import { refLookupKey, RED_LINE_KEY } from './carry-forward-feature-ids.js'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STORED_ID = '11111111-1111-4111-8111-111111111111'
const STORED_ID_2 = '22222222-2222-4222-8222-222222222222'
const STORED_RED_LINE_ID = '33333333-3333-4333-8333-333333333333'

const areaFeature = (parcelRef) => ({
  nativeGeometry: { type: 'Polygon' },
  properties: { 'Parcel Ref': parcelRef }
})

describe('assignFeatureIds', () => {
  it('stamps a UUID featureId onto every feature in every layer', () => {
    const layers = {
      areas: [{ nativeGeometry: { type: 'Polygon' } }],
      hedgerows: [{ nativeGeometry: { type: 'LineString' } }],
      watercourses: []
    }

    const result = assignFeatureIds(layers)

    expect(result.areas[0].featureId).toMatch(UUID_REGEX)
    expect(result.hedgerows[0].featureId).toMatch(UUID_REGEX)
    expect(result.watercourses).toEqual([])
  })

  it('assigns unique featureIds across features in the same layer', () => {
    const layers = {
      areas: [
        { nativeGeometry: { type: 'Polygon' } },
        { nativeGeometry: { type: 'Polygon' } }
      ]
    }

    const result = assignFeatureIds(layers)

    expect(result.areas[0].featureId).not.toBe(result.areas[1].featureId)
  })

  it('does not mutate the original feature objects', () => {
    const original = { nativeGeometry: { type: 'Polygon' } }
    const layers = { areas: [original] }

    assignFeatureIds(layers)

    expect(original).not.toHaveProperty('featureId')
  })

  it('preserves all existing feature properties', () => {
    const layers = {
      areas: [
        {
          nativeGeometry: { type: 'Polygon' },
          nativeSrid: 27700,
          properties: { fid: 1 }
        }
      ]
    }

    const result = assignFeatureIds(layers)

    expect(result.areas[0]).toMatchObject({
      nativeGeometry: { type: 'Polygon' },
      nativeSrid: 27700,
      properties: { fid: 1 }
    })
  })

  // `missingLayers` holds plain layer-name strings, not features. Spreading one
  // would explode it into { 0: 'H', 1: 'a', ... }.
  it('leaves non-object array entries untouched', () => {
    const layers = { missingLayers: ['Habitats', 'Rivers'] }

    const result = assignFeatureIds(layers)

    expect(result.missingLayers).toEqual(['Habitats', 'Rivers'])
  })

  it('passes through non-array layer values', () => {
    const result = assignFeatureIds({ areas: [], missingLayers: undefined })

    expect(result.missingLayers).toBeUndefined()
  })

  describe('carry-forward', () => {
    it('reuses the stored featureId when the ref matches', () => {
      const featureIdByRef = new Map([
        [refLookupKey('habitats', 'PR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { areas: [areaFeature('PR-1')] },
        featureIdByRef
      )

      expect(result.areas[0].featureId).toBe(STORED_ID)
    })

    it('maps the raw `areas` layer onto the document `habitats` layer', () => {
      const featureIdByRef = new Map([
        [refLookupKey('areas', 'PR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { areas: [areaFeature('PR-1')] },
        featureIdByRef
      )

      // Keyed under the raw name, so nothing matches — proof the lookup uses
      // the document layer name, not the GeoPackage one.
      expect(result.areas[0].featureId).not.toBe(STORED_ID)
    })

    it('mints a fresh id for a ref with nothing stored', () => {
      const featureIdByRef = new Map([
        [refLookupKey('habitats', 'PR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { areas: [areaFeature('PR-2')] },
        featureIdByRef
      )

      expect(result.areas[0].featureId).toMatch(UUID_REGEX)
      expect(result.areas[0].featureId).not.toBe(STORED_ID)
    })

    it('mints a fresh id when the incoming ref is blank', () => {
      const featureIdByRef = new Map([
        [refLookupKey('habitats', 'PR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { areas: [areaFeature('')] },
        featureIdByRef
      )

      expect(result.areas[0].featureId).toMatch(UUID_REGEX)
    })

    // Ref uniqueness is only enforced on the habitats layer, so a repeated ref
    // is legitimate elsewhere and must not hand the same id to both features.
    it('refuses to match a ref duplicated in the incoming layer', () => {
      const featureIdByRef = new Map([
        [refLookupKey('hedgerows', 'DUP'), STORED_ID]
      ])
      const hedge = (ref) => ({ properties: { 'Parcel Ref': ref } })

      const result = assignFeatureIds(
        { hedgerows: [hedge('DUP'), hedge('DUP')] },
        featureIdByRef
      )

      expect(result.hedgerows[0].featureId).not.toBe(STORED_ID)
      expect(result.hedgerows[1].featureId).not.toBe(STORED_ID)
      expect(result.hedgerows[0].featureId).not.toBe(
        result.hedgerows[1].featureId
      )
    })

    it('reads the tree ref from the Tree Ref column', () => {
      const featureIdByRef = new Map([
        [refLookupKey('trees', 'TR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { trees: [{ properties: { 'Tree Ref': 'TR-1' } }] },
        featureIdByRef
      )

      expect(result.trees[0].featureId).toBe(STORED_ID)
    })

    it('matches refs case-insensitively across column-name variants', () => {
      const featureIdByRef = new Map([
        [refLookupKey('habitats', 'PR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { areas: [{ properties: { parcel_ref: 'PR-1' } }] },
        featureIdByRef
      )

      expect(result.areas[0].featureId).toBe(STORED_ID)
    })

    it('carries the red line id onto the first feature only', () => {
      const featureIdByRef = new Map([[RED_LINE_KEY, STORED_RED_LINE_ID]])

      const result = assignFeatureIds(
        { redline: [{ properties: {} }, { properties: {} }] },
        featureIdByRef
      )

      expect(result.redline[0].featureId).toBe(STORED_RED_LINE_ID)
      expect(result.redline[1].featureId).not.toBe(STORED_RED_LINE_ID)
    })

    // Reachable when the stored document had features but no red line.
    it('mints a red line id when the map carries no stored red line', () => {
      const featureIdByRef = new Map([
        [refLookupKey('habitats', 'PR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { redline: [{ properties: {} }] },
        featureIdByRef
      )

      expect(result.redline[0].featureId).toMatch(UUID_REGEX)
    })

    it('gives iggis features fresh ids — they are validation-only', () => {
      const featureIdByRef = new Map([
        [refLookupKey('habitats', 'PR-1'), STORED_ID]
      ])

      const result = assignFeatureIds(
        { iggis: [areaFeature('PR-1')] },
        featureIdByRef
      )

      expect(result.iggis[0].featureId).toMatch(UUID_REGEX)
      expect(result.iggis[0].featureId).not.toBe(STORED_ID)
    })

    it('keeps distinct refs on distinct ids', () => {
      const featureIdByRef = new Map([
        [refLookupKey('habitats', 'PR-1'), STORED_ID],
        [refLookupKey('habitats', 'PR-2'), STORED_ID_2]
      ])

      const result = assignFeatureIds(
        { areas: [areaFeature('PR-2'), areaFeature('PR-1')] },
        featureIdByRef
      )

      expect(result.areas[0].featureId).toBe(STORED_ID_2)
      expect(result.areas[1].featureId).toBe(STORED_ID)
    })
  })
})
