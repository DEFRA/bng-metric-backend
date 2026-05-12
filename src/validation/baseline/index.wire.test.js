import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./geopackage.js', () => ({
  readBaselineGeoPackage: vi.fn(() => ({
    redline: [],
    areas: [],
    missingLayers: []
  }))
}))
vi.mock('./postgis/index.js', () => ({
  validateBaselineLayersPostgis: vi.fn(async () => ({
    valid: true,
    errors: []
  }))
}))

const BASELINE_WIRE_MKDTEMP_PREFIX = 'bng-baseline-wire-test-'

describe('validateBaselineFile / validateBaselineLayers wired to Postgres', () => {
  let validateBaselineFile
  let validateBaselineLayers
  let readBaselineGeoPackage
  let validateBaselineLayersPostgis

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ validateBaselineFile, validateBaselineLayers } =
      await import('./index.js'))
    ;({ readBaselineGeoPackage } = await import('./geopackage.js'))
    ;({ validateBaselineLayersPostgis } = await import('./postgis/index.js'))
  })

  it('validateBaselineFile reads the GeoPackage then runs PostGIS validation', async () => {
    const pooled = {}

    vi.mocked(validateBaselineLayersPostgis).mockResolvedValueOnce({
      valid: false,
      errors: [{ code: 'X', message: 'y' }]
    })

    const tempPrefix = join(tmpdir(), BASELINE_WIRE_MKDTEMP_PREFIX)
    const isolateDir = await mkdtemp(tempPrefix)
    const filePath = join(isolateDir, 'test.gpkg')
    try {
      const out = await validateBaselineFile(filePath, pooled)

      expect(readBaselineGeoPackage).toHaveBeenCalledWith(filePath)
      expect(validateBaselineLayersPostgis).toHaveBeenCalledWith(pooled, {
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

  it('validateBaselineLayers forwards layers to validateBaselineLayersPostgis', async () => {
    const pooled = {}
    const layers = { redline: [1], areas: [] }
    vi.mocked(validateBaselineLayersPostgis).mockResolvedValueOnce({
      valid: true,
      errors: []
    })

    const out = await validateBaselineLayers(layers, pooled)

    expect(readBaselineGeoPackage).not.toHaveBeenCalled()
    expect(validateBaselineLayersPostgis).toHaveBeenCalledWith(pooled, layers)
    expect(out).toEqual({ valid: true, errors: [] })
  })
})
