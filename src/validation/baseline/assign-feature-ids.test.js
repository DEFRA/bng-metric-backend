import { describe, it, expect } from 'vitest'

import { assignFeatureIds } from './assign-feature-ids.js'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
})
