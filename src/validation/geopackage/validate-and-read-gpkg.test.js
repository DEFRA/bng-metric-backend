import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Counts how many shapes are actually unpacked, so the tests can pin the
// promise of BMD-910: a structurally broken file unpacks none, and an
// acceptable one unpacks each shape exactly once for both jobs.
const wkbToGeoJSONSpy = vi.fn()

vi.mock('bng-library/gpkg-io', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    wkbToGeoJSON: (...args) => {
      wkbToGeoJSONSpy(...args)
      return actual.wkbToGeoJSON(...args)
    }
  }
})

const {
  ALL_LAYERS,
  GP10_APP_ID,
  LAYER_RLB,
  EPSG_WEB_MERCATOR,
  buildBuffer,
  fullReadBuffer,
  makePolygon,
  walModeFullReadBuffer,
  readTestPolygonWkb,
  withTempGpkgFile,
  wrapGpkgWkb
} = await import('../../../test/helpers/gpkg.js')

const { validateAndReadGpkgFile, validateGpkg, readGeoPackage } =
  await import('./geopackage.js')
const { ERROR_CODES } = await import('./errors.js')

/** Every feature in fullReadBuffer(): RLB, Habitats, Hedgerows, Rivers, Trees. */
const FULL_READ_FEATURE_COUNT = 5

/** Stage a buffer as a file, the way a downloaded upload arrives (BMD-913). */
function validateAndReadBuffer(buffer) {
  return withTempGpkgFile(buffer, validateAndReadGpkgFile)
}

describe('validateAndReadGpkgFile — one parse for both jobs', () => {
  beforeEach(() => {
    wkbToGeoJSONSpy.mockClear()
  })

  it('validates and returns the layers from a single read of the file', async () => {
    const buffer = fullReadBuffer()

    const result = await validateAndReadBuffer(buffer)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    // Identical to what a separate read of the same bytes from disk produced.
    const fromDisk = await withTempGpkgFile(buffer, readGeoPackage)
    expect(result.layers).toEqual(fromDisk)
  })

  it('unpacks each shape exactly once', async () => {
    await validateAndReadBuffer(fullReadBuffer())

    expect(wkbToGeoJSONSpy).toHaveBeenCalledTimes(FULL_READ_FEATURE_COUNT)
  })

  it('rejects a structurally broken file without unpacking any shape', async () => {
    // Habitats missing: a required layer, caught before any geometry is read.
    const result = await validateAndReadBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: [LAYER_RLB],
        layerFeatures: { [LAYER_RLB]: [makePolygon()] }
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain(
      ERROR_CODES.GPKG_MISSING_LAYER
    )
    expect(result.layers).toBeNull()
    expect(wkbToGeoJSONSpy).not.toHaveBeenCalled()
  })

  it('returns no layers when the feature checks reject the file', async () => {
    const result = await validateAndReadBuffer(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS,
        layerFeatures: {
          [LAYER_RLB]: [
            wrapGpkgWkb(readTestPolygonWkb()),
            wrapGpkgWkb(readTestPolygonWkb())
          ]
        }
      })
    )

    expect(result.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.GPKG_RLB_TOO_MANY_POLYGONS
    ])
    expect(result.layers).toBeNull()
  })

  it('returns no layers when the file is not a database at all', async () => {
    const result = await validateAndReadBuffer(
      Buffer.from('this is not a database')
    )

    expect(result).toEqual({
      valid: false,
      errors: [
        {
          code: ERROR_CODES.GPKG_INVALID_FILE,
          message: 'File is not a valid GeoPackage'
        }
      ],
      layers: null
    })
    expect(wkbToGeoJSONSpy).not.toHaveBeenCalled()
  })

  it('returns no layers when the file is not there at all', () => {
    const result = validateAndReadGpkgFile(
      join(tmpdir(), 'bmd-913-does-not-exist.gpkg')
    )

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.GPKG_INVALID_FILE
    ])
    expect(result.layers).toBeNull()
  })

  it('reads a WAL-mode file in place rather than restaging it', async () => {
    const result = await validateAndReadBuffer(walModeFullReadBuffer())

    expect(result.valid).toBe(true)
    expect(result.layers).not.toBeNull()
  })

  it('rejects a feature whose SRID cannot be reprojected', async () => {
    const buffer = fullReadBuffer({
      [LAYER_RLB]: [wrapGpkgWkb(readTestPolygonWkb(), EPSG_WEB_MERCATOR)]
    })

    await expect(validateAndReadBuffer(buffer)).rejects.toThrow(
      /Unsupported SRID/
    )
  })
})

describe('validateGpkg — format gate only', () => {
  beforeEach(() => {
    wkbToGeoJSONSpy.mockClear()
  })

  it('classifies geometries without unpacking them', () => {
    expect(validateGpkg(fullReadBuffer())).toEqual({ valid: true, errors: [] })
    expect(wkbToGeoJSONSpy).not.toHaveBeenCalled()
  })
})
