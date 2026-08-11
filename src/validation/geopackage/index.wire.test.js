import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from './errors.js'

vi.mock('./geopackage.js', () => ({
  readGeoPackage: vi.fn(() => ({
    redline: [],
    areas: [],
    missingLayers: []
  }))
}))
vi.mock('./postgis/index.js', () => ({
  validateGeoPackageLayersPostgis: vi.fn(async () => ({
    valid: true,
    errors: []
  }))
}))
vi.mock('./distinctiveness-check.js', () => ({
  checkHabitatDistinctiveness: vi.fn(() => null)
}))

const BASELINE_WIRE_MKDTEMP_PREFIX = 'bng-baseline-wire-test-'

describe('validateBaselineFile wired to Postgres', () => {
  let validateBaselineFile
  let readGeoPackage
  let validateGeoPackageLayersPostgis

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ validateBaselineFile } = await import('./index.js'))
    ;({ readGeoPackage } = await import('./geopackage.js'))
    ;({ validateGeoPackageLayersPostgis } = await import('./postgis/index.js'))
  })

  it('reads the GeoPackage then runs PostGIS validation', async () => {
    const pooled = {}

    vi.mocked(validateGeoPackageLayersPostgis).mockResolvedValueOnce({
      valid: false,
      errors: [{ code: 'X', message: 'y' }]
    })

    const tempPrefix = join(tmpdir(), BASELINE_WIRE_MKDTEMP_PREFIX)
    const isolateDir = await mkdtemp(tempPrefix)
    const filePath = join(isolateDir, 'test.gpkg')
    try {
      const out = await validateBaselineFile(filePath, pooled)

      expect(readGeoPackage).toHaveBeenCalledWith(filePath)
      expect(validateGeoPackageLayersPostgis).toHaveBeenCalledWith(pooled, {
        redline: [],
        areas: [],
        missingLayers: []
      })
      expect(out).toEqual({
        valid: false,
        errors: [{ code: 'X', message: 'y' }]
      })
    } finally {
      await rm(isolateDir, { recursive: true, force: true })
    }
  })
})

describe('validateGeoPackageLayers wired to Postgres', () => {
  let validateGeoPackageLayers
  let readGeoPackage
  let validateGeoPackageLayersPostgis
  let checkHabitatDistinctiveness

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ validateGeoPackageLayers } = await import('./index.js'))
    ;({ readGeoPackage } = await import('./geopackage.js'))
    ;({ validateGeoPackageLayersPostgis } = await import('./postgis/index.js'))
    ;({ checkHabitatDistinctiveness } =
      await import('./distinctiveness-check.js'))
  })

  it('forwards layers to validateGeoPackageLayersPostgis', async () => {
    const pooled = {}
    const layers = { redline: [1], areas: [] }
    vi.mocked(validateGeoPackageLayersPostgis).mockResolvedValueOnce({
      valid: true,
      errors: []
    })

    const out = await validateGeoPackageLayers(layers, pooled)

    expect(readGeoPackage).not.toHaveBeenCalled()
    expect(validateGeoPackageLayersPostgis).toHaveBeenCalledWith(pooled, layers)
    expect(out).toEqual({ valid: true, errors: [] })
  })

  it('prepends a distinctiveness error ahead of geometry errors', async () => {
    const pooled = {}
    const layers = { redline: [1], areas: [{}] }
    vi.mocked(validateGeoPackageLayersPostgis).mockResolvedValueOnce({
      valid: false,
      errors: [{ code: ERROR_CODES.PARCEL_OVERLAPS, message: 'overlap' }]
    })
    vi.mocked(checkHabitatDistinctiveness).mockReturnValueOnce({
      code: ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      message: 'out of scope',
      details: { count: 1, sample: [] }
    })

    const out = await validateGeoPackageLayers(layers, pooled)

    expect(out.valid).toBe(false)
    expect(out.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      ERROR_CODES.PARCEL_OVERLAPS
    ])
  })

  it('flips valid → false when only the distinctiveness check fails', async () => {
    const pooled = {}
    const layers = { redline: [1], areas: [{}] }
    vi.mocked(validateGeoPackageLayersPostgis).mockResolvedValueOnce({
      valid: true,
      errors: []
    })
    vi.mocked(checkHabitatDistinctiveness).mockReturnValueOnce({
      code: ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      message: 'out of scope',
      details: { count: 1, sample: [] }
    })

    const out = await validateGeoPackageLayers(layers, pooled)
    expect(out.valid).toBe(false)
    expect(out.errors).toHaveLength(1)
  })
})
