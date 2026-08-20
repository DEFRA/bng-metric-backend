import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

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
  readTestPolygonWkb,
  removeStagedGpkgFiles,
  stageGpkgFile,
  withTempGpkgFile,
  wrapGpkgWkb
} = await import('../../../test/helpers/gpkg.js')

const { validateAndReadGpkg, readGeoPackage } = await import('./geopackage.js')
const { ERROR_CODES } = await import('./errors.js')

afterAll(removeStagedGpkgFiles)

/** Every feature in fullReadBuffer(): RLB, Habitats, Hedgerows, Rivers, Trees. */
const FULL_READ_FEATURE_COUNT = 5

describe('validateAndReadGpkg — one parse for both jobs', () => {
  beforeEach(() => {
    wkbToGeoJSONSpy.mockClear()
  })

  it('validates and returns the layers from a single read of the file', async () => {
    const buffer = fullReadBuffer()

    const result = validateAndReadGpkg(stageGpkgFile(buffer))

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    // Identical to what a separate read of the same bytes from disk produced.
    const fromDisk = await withTempGpkgFile(buffer, readGeoPackage)
    expect(result.layers).toEqual(fromDisk)
  })

  it('unpacks each shape exactly once', () => {
    validateAndReadGpkg(stageGpkgFile(fullReadBuffer()))

    expect(wkbToGeoJSONSpy).toHaveBeenCalledTimes(FULL_READ_FEATURE_COUNT)
  })

  it('rejects a structurally broken file without unpacking any shape', () => {
    // Habitats missing: a required layer, caught before any geometry is read.
    const result = validateAndReadGpkg(
      stageGpkgFile(
        buildBuffer({
          appId: GP10_APP_ID,
          systemTables: true,
          featureLayers: [LAYER_RLB],
          layerFeatures: { [LAYER_RLB]: [makePolygon()] }
        })
      )
    )

    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain(
      ERROR_CODES.GPKG_MISSING_LAYER
    )
    expect(result.layers).toBeNull()
    expect(wkbToGeoJSONSpy).not.toHaveBeenCalled()
  })

  it('returns no layers when the feature checks reject the file', () => {
    const result = validateAndReadGpkg(
      stageGpkgFile(
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
    )

    expect(result.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.GPKG_RLB_TOO_MANY_POLYGONS
    ])
    expect(result.layers).toBeNull()
  })

  it('returns no layers when the file is not a database at all', () => {
    const result = validateAndReadGpkg(
      stageGpkgFile(Buffer.from('this is not a database'))
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

  it('rejects a feature whose SRID cannot be reprojected', () => {
    const buffer = fullReadBuffer({
      [LAYER_RLB]: [wrapGpkgWkb(readTestPolygonWkb(), EPSG_WEB_MERCATOR)]
    })

    expect(() => validateAndReadGpkg(stageGpkgFile(buffer))).toThrow(
      /Unsupported SRID/
    )
  })
})
