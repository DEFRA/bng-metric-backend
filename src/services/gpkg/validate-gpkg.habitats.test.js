import { describe, it, expect } from 'vitest'

import {
  ALL_LAYERS,
  ERR_UNREADABLE_HABITATS,
  ERR_ZERO_HABITATS,
  GP10_APP_ID,
  LAYER_HABITATS,
  LAYER_RLB,
  buildBuffer,
  makeCorruptBlob,
  makeLineString,
  makePoint,
  makePolygon,
  missingLayerError
} from './validate-gpkg.test-helpers.js'

const { validateGpkg } = await import('./validate-gpkg.js')
const { ERROR_CODES } = await import('../../validation/baseline/errors.js')

describe('validateGpkg when the Habitats geometry column is missing or invalid', () => {
  it('returns a descriptive error when there is no registered geometry column', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        geomColumnNames: { habitats: null }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      code: ERROR_CODES.GPKG_HABITATS_NO_GEOMETRY_COLUMN,
      message:
        'Habitats layer has no registered geometry column in gpkg_geometry_columns'
    })
  })

  it('returns a descriptive error for a column name that fails the identifier check', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        geomColumnNames: {
          habitats: 'geom"; DROP TABLE "Habitats"; --'
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      code: ERROR_CODES.GPKG_HABITATS_INVALID_GEOMETRY_COLUMN_NAME,
      message:
        'Habitats geometry column has an invalid name in gpkg_geometry_columns'
    })
  })
})

describe('validateGpkg when the Habitats layer has zero area habitat parcels', () => {
  it('returns an error when there are no features at all', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: { [LAYER_HABITATS]: [] }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual(ERR_ZERO_HABITATS)
  })

  it('returns an error when the only features are non-polygon geometries', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_HABITATS]: [makeLineString(), makePoint()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual(ERR_ZERO_HABITATS)
  })

  it('is valid with multiple polygon features (unlike RLB)', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_HABITATS]: [makePolygon(), makePolygon(), makePolygon()]
        }
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('counts polygons even when mixed with non-polygon rows', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_HABITATS]: [makePolygon(), makeLineString()]
        }
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })
})

describe('validateGpkg when the Habitats layer contains unreadable geometry', () => {
  it('returns an error when any geometry blob is unreadable', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_HABITATS]: [makePolygon(), makeCorruptBlob()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual(ERR_UNREADABLE_HABITATS)
  })

  it('does not also report a zero-parcel error when geometry is unreadable', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_HABITATS]: [makeCorruptBlob()]
        }
      })
    )

    expect(result.errors).not.toContainEqual(ERR_ZERO_HABITATS)
    expect(result.errors).toContainEqual(ERR_UNREADABLE_HABITATS)
  })
})

describe('validateGpkg when the Habitats layer is missing entirely', () => {
  it('reports only the missing-layer error and does not also flag zero parcels', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: [LAYER_RLB]
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(missingLayerError(LAYER_HABITATS))
    expect(result.errors).not.toContainEqual(ERR_ZERO_HABITATS)
  })
})
