/**
 * Tests for the optional Hedgerows and Rivers layer validators invoked during
 * the format gate. Both layers are optional (not required by gpkg-template.schema.json):
 * - Absent → no error
 * - Present but empty (zero rows) → no error
 * - Present with readable linestrings only → no error
 * - Present with no linestrings (e.g. polygons only) → GPKG_*_NO_LINESTRING_GEOMETRY
 * - Present with mixed linestrings and other types → GPKG_*_WRONG_GEOMETRY_TYPE
 * - Present with unreadable geometry → GPKG_*_UNREADABLE_GEOMETRY
 */

import { describe, it, expect, afterAll } from 'vitest'

import {
  GP10_APP_ID,
  ALL_LAYERS,
  FULL_READ_LAYERS,
  ERR_NO_LINESTRING_HEDGEROWS,
  ERR_NO_LINESTRING_RIVERS,
  ERR_UNREADABLE_HEDGEROWS,
  ERR_UNREADABLE_RIVERS,
  ERR_WRONG_GEOMETRY_HEDGEROWS,
  ERR_WRONG_GEOMETRY_RIVERS,
  buildBuffer,
  makeLineString,
  makePolygon,
  makeCorruptBlob,
  removeStagedGpkgFiles,
  stageGpkgFile
} from '../../../test/helpers/gpkg.js'

const LAYER_HEDGEROWS = 'Hedgerows'
const LAYER_RIVERS = 'Rivers'

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

// Helper: build a buffer that includes the given linear layer populated with
// the supplied blob array.
function buildWithLinearLayer(layerName, blobs) {
  return buildBuffer({
    appId: GP10_APP_ID,
    systemTables: true,
    featureLayers: [...ALL_LAYERS, layerName],
    layerFeatures: { [layerName]: blobs }
  })
}

// ---------------------------------------------------------------------------
// Hedgerows
// ---------------------------------------------------------------------------

describe('format gate — Hedgerows layer absent', () => {
  it('passes when Hedgerows is not registered in gpkg_contents', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          'Red Line Boundary': [makePolygon()],
          Habitats: [makePolygon()]
        }
      })
    )
    expect(result.errors).not.toContainEqual(ERR_UNREADABLE_HEDGEROWS)
  })
})

describe('format gate — Hedgerows layer present but empty', () => {
  it('passes silently when Hedgerows has zero rows', () => {
    const result = gateBuffer(buildWithLinearLayer(LAYER_HEDGEROWS, []))
    expect(result.errors).not.toContainEqual(ERR_UNREADABLE_HEDGEROWS)
  })
})

describe('format gate — Hedgerows layer with valid geometry', () => {
  it('is valid when all Hedgerow features have readable linestring geometry', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_HEDGEROWS, [
        makeLineString(),
        makeLineString()
      ])
    )
    expect(result.errors).not.toContainEqual(ERR_UNREADABLE_HEDGEROWS)
    const hedgerowCodes = result.errors.filter((e) =>
      e.code.includes('HEDGEROW')
    )
    expect(hedgerowCodes).toHaveLength(0)
  })
})

describe('format gate — Hedgerows layer with wrong geometry type', () => {
  it('reports GPKG_HEDGEROWS_NO_LINESTRING_GEOMETRY when features are polygons only', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_HEDGEROWS, [makePolygon()])
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(ERR_NO_LINESTRING_HEDGEROWS)
  })

  it('reports GPKG_HEDGEROWS_WRONG_GEOMETRY_TYPE when linestrings are mixed with polygons', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_HEDGEROWS, [makeLineString(), makePolygon()])
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(ERR_WRONG_GEOMETRY_HEDGEROWS)
    expect(result.errors).not.toContainEqual(ERR_NO_LINESTRING_HEDGEROWS)
  })
})

describe('format gate — Hedgerows layer with unreadable geometry', () => {
  it('reports GPKG_HEDGEROWS_UNREADABLE_GEOMETRY when any blob is corrupt', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_HEDGEROWS, [
        makeLineString(),
        makeCorruptBlob()
      ])
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(ERR_UNREADABLE_HEDGEROWS)
  })

  it('reports the error even when the only row is corrupt', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_HEDGEROWS, [makeCorruptBlob()])
    )
    expect(result.errors).toContainEqual(ERR_UNREADABLE_HEDGEROWS)
  })

  it('does not produce a duplicate error for the same layer', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_HEDGEROWS, [
        makeCorruptBlob(),
        makeCorruptBlob()
      ])
    )
    const hedgerowErrors = result.errors.filter(
      (e) => e.code === ERROR_CODES.GPKG_HEDGEROWS_UNREADABLE_GEOMETRY
    )
    expect(hedgerowErrors).toHaveLength(1)
  })

  it('does not also report a no-linestring error when geometry is unreadable', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_HEDGEROWS, [makeCorruptBlob()])
    )
    expect(result.errors).toContainEqual(ERR_UNREADABLE_HEDGEROWS)
    expect(result.errors).not.toContainEqual(ERR_NO_LINESTRING_HEDGEROWS)
  })
})

// ---------------------------------------------------------------------------
// Rivers
// ---------------------------------------------------------------------------

describe('format gate — Rivers layer absent', () => {
  it('passes when Rivers is not registered in gpkg_contents', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          'Red Line Boundary': [makePolygon()],
          Habitats: [makePolygon()]
        }
      })
    )
    expect(result.errors).not.toContainEqual(ERR_UNREADABLE_RIVERS)
  })
})

describe('format gate — Rivers layer present but empty', () => {
  it('passes silently when Rivers has zero rows', () => {
    const result = gateBuffer(buildWithLinearLayer(LAYER_RIVERS, []))
    expect(result.errors).not.toContainEqual(ERR_UNREADABLE_RIVERS)
  })
})

describe('format gate — Rivers layer with valid geometry', () => {
  it('is valid when all River features have readable linestring geometry', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_RIVERS, [makeLineString()])
    )
    expect(result.errors).not.toContainEqual(ERR_UNREADABLE_RIVERS)
    const riverCodes = result.errors.filter((e) => e.code.includes('RIVER'))
    expect(riverCodes).toHaveLength(0)
  })
})

describe('format gate — Rivers layer with wrong geometry type', () => {
  it('reports GPKG_RIVERS_NO_LINESTRING_GEOMETRY when features are polygons only', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_RIVERS, [makePolygon(), makePolygon()])
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(ERR_NO_LINESTRING_RIVERS)
  })

  it('reports GPKG_RIVERS_WRONG_GEOMETRY_TYPE when linestrings are mixed with polygons', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_RIVERS, [makeLineString(), makePolygon()])
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(ERR_WRONG_GEOMETRY_RIVERS)
  })
})

describe('format gate — Rivers layer with unreadable geometry', () => {
  it('reports GPKG_RIVERS_UNREADABLE_GEOMETRY when any blob is corrupt', () => {
    const result = gateBuffer(
      buildWithLinearLayer(LAYER_RIVERS, [makeLineString(), makeCorruptBlob()])
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(ERR_UNREADABLE_RIVERS)
  })
})

// ---------------------------------------------------------------------------
// Both layers present — independent errors
// ---------------------------------------------------------------------------

describe('format gate — both Hedgerows and Rivers have corrupt geometry', () => {
  it('reports both errors independently', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: [...ALL_LAYERS, LAYER_HEDGEROWS, LAYER_RIVERS],
        layerFeatures: {
          [LAYER_HEDGEROWS]: [makeCorruptBlob()],
          [LAYER_RIVERS]: [makeCorruptBlob()]
        }
      })
    )
    expect(result.errors).toContainEqual(ERR_UNREADABLE_HEDGEROWS)
    expect(result.errors).toContainEqual(ERR_UNREADABLE_RIVERS)
  })
})

describe('format gate — full-stack buffer with Hedgerows and Rivers', () => {
  it('passes when all layers including hedgerows and rivers have valid geometry', () => {
    const result = gateBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: FULL_READ_LAYERS,
        layerFeatures: {
          'Red Line Boundary': [makePolygon()],
          Habitats: [makePolygon()],
          Hedgerows: [makeLineString()],
          Rivers: [makeLineString()]
        }
      })
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})
