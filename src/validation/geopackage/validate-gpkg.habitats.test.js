import { describe, it, expect, afterAll } from 'vitest'

import {
  ALL_LAYERS,
  ERR_HABITATS_WRONG_GEOMETRY,
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
  missingLayerError,
  removeStagedGpkgFiles,
  stageGpkgFile
} from '../../../test/helpers/gpkg.js'

const { validateAndReadGpkg } = await import('./geopackage.js')

/**
 * These are format-gate tests: they build a fixture in memory, stage it to a
 * file the way the upload route now does (BMD-913), and assert on the gate
 * verdict alone. The parsed layers are covered by validate-and-read-gpkg.test.js.
 */
function gateBuffer(buffer) {
  const { valid, errors } = validateAndReadGpkg(stageGpkgFile(buffer))
  return { valid, errors }
}

afterAll(removeStagedGpkgFiles)

const { ERROR_CODES } = await import('./errors.js')

describe('format gate when the Habitats geometry column is missing or invalid', () => {
  it('returns a descriptive error when there is no registered geometry column', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        habitatsGeomColumnName: null
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
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        habitatsGeomColumnName: 'geom"; DROP TABLE "Habitats"; --'
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      code: ERROR_CODES.GPKG_BASELINE_INVALID_GEOMETRY_COLUMN_NAME,
      message:
        'Layer "Habitats" geometry column "geom"; DROP TABLE "Habitats"; --" has an invalid name in gpkg_geometry_columns'
    })
  })
})

describe('format gate when the Habitats layer has zero area habitat parcels', () => {
  it('returns an error when there are no features at all', () => {
    const result = gateBuffer(
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
    const result = gateBuffer(
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
    const result = gateBuffer(
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

  it('returns an error when polygon and non-polygon geometries are mixed', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_HABITATS]: [makePolygon(), makeLineString()]
        }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual(ERR_HABITATS_WRONG_GEOMETRY)
  })
})

describe('format gate when the Habitats layer contains unreadable geometry', () => {
  it('returns an error when any geometry blob is unreadable', () => {
    const result = gateBuffer(
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
    const result = gateBuffer(
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

describe('format gate when the Habitats layer is missing entirely', () => {
  it('reports only the missing-layer error and does not also flag zero parcels', () => {
    const result = gateBuffer(
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
