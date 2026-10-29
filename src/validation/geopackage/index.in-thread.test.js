import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from './errors.js'
import { readGeoPackage } from './geopackage.js'
import { getGeosWorkerPool } from './geos/worker-pool.js'
import { validateGeoPackageLayers } from './index.js'
import { FEATURE_READ_MODE } from './read-feature-tables.js'

vi.mock('./geos/worker-pool.js', () => ({ getGeosWorkerPool: vi.fn() }))

const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../integration-tests/fixtures/baseline-complete.gpkg'
)

// `inThread` is for a caller with no pool to queue behind: importUploadFile,
// which the metric comparison in bng-metric-harness calls.
describe('validateGeoPackageLayers in thread', () => {
  it('runs the geometry checks without the worker pool', async () => {
    const result = await validateGeoPackageLayers(
      () => readGeoPackage(FIXTURE, FEATURE_READ_MODE.properties),
      'baseline',
      { filePath: FIXTURE, includeSizes: true, inThread: true }
    )

    expect(getGeosWorkerPool).not.toHaveBeenCalled()
    expect(result).toMatchObject({ valid: true, errors: [] })
    expect(result.sizes.areas.length).toBeGreaterThan(0)
    expect(result.poolTelemetry).toBeUndefined()
  })

  it('still puts the data-quality errors first', async () => {
    const layers = readGeoPackage(FIXTURE, FEATURE_READ_MODE.properties)
    layers.areas[0].properties['Parcel Ref'] = ''

    const result = await validateGeoPackageLayers(layers, 'baseline', {
      filePath: FIXTURE,
      inThread: true
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe(ERROR_CODES.HABITAT_REF_MISSING)
  })
})
