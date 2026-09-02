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
vi.mock('./geos/worker-pool.js', () => ({
  getGeosWorkerPool: vi.fn(() => ({
    run: vi.fn(async () => ({ valid: true, errors: [] })),
    stats: () => ({ size: 1, idle: 1, queued: 0 })
  }))
}))
vi.mock('./distinctiveness-check.js', () => ({
  checkHabitatDistinctiveness: vi.fn(() => null)
}))

const BASELINE_WIRE_MKDTEMP_PREFIX = 'bng-baseline-wire-test-'

/** Point the mocked pool at one behaviour for the length of a test. */
function poolRuns(getGeosWorkerPool, implementation) {
  const run = vi.fn(implementation)
  getGeosWorkerPool.mockReturnValue({
    run,
    stats: () => ({ size: 1, idle: 1, queued: 0 })
  })
  return run
}

describe('validateBaselineFile wired to the worker pool', () => {
  let validateBaselineFile
  let readGeoPackage
  let getGeosWorkerPool

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ validateBaselineFile } = await import('./index.js'))
    ;({ readGeoPackage } = await import('./geopackage.js'))
    ;({ getGeosWorkerPool } = await import('./geos/worker-pool.js'))
  })

  it('reads the GeoPackage, then hands its PATH to a worker', async () => {
    const run = poolRuns(getGeosWorkerPool, async () => ({
      valid: false,
      errors: [{ code: 'X', message: 'y' }]
    }))

    const isolateDir = await mkdtemp(
      join(tmpdir(), BASELINE_WIRE_MKDTEMP_PREFIX)
    )
    const filePath = join(isolateDir, 'test.gpkg')
    try {
      const out = await validateBaselineFile(filePath)

      // The main thread still parses for the data-quality checks; the worker
      // gets the path and parses its own copy off the event loop.
      expect(readGeoPackage).toHaveBeenCalledWith(filePath)
      expect(run).toHaveBeenCalledWith(filePath, { includeSizes: false })
      expect(out).toMatchObject({
        valid: false,
        errors: [{ code: 'X', message: 'y' }]
      })
    } finally {
      await rm(isolateDir, { recursive: true, force: true })
    }
  })
})

describe('validateGeoPackageLayers wired to the worker pool', () => {
  let validateGeoPackageLayers
  let readGeoPackage
  let getGeosWorkerPool
  let checkHabitatDistinctiveness

  const FILE = '/tmp/upload.gpkg'

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ validateGeoPackageLayers } = await import('./index.js'))
    ;({ readGeoPackage } = await import('./geopackage.js'))
    ;({ getGeosWorkerPool } = await import('./geos/worker-pool.js'))
    ;({ checkHabitatDistinctiveness } =
      await import('./distinctiveness-check.js'))
  })

  it('sends the file path to a worker without re-reading the file', async () => {
    const run = poolRuns(getGeosWorkerPool, async () => ({
      valid: true,
      errors: []
    }))

    const out = await validateGeoPackageLayers(
      { redline: [1], areas: [] },
      'baseline',
      { filePath: FILE }
    )

    expect(readGeoPackage).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith(FILE, { includeSizes: false })
    expect(out).toMatchObject({ valid: true, errors: [] })
  })

  it('asks the worker for sizes when the caller wants them', async () => {
    const run = poolRuns(getGeosWorkerPool, async () => ({
      valid: true,
      errors: [],
      sizes: { areas: [{ idx: 0, value: 10 }] }
    }))

    const out = await validateGeoPackageLayers({ areas: [] }, 'baseline', {
      filePath: FILE,
      includeSizes: true
    })

    expect(run).toHaveBeenCalledWith(FILE, { includeSizes: true })
    expect(out.sizes).toEqual({ areas: [{ idx: 0, value: 10 }] })
  })

  it('lets a full queue propagate, so the route can answer 503', async () => {
    const queueFull = new Error('Geometry validation queue is full (8 waiting)')
    queueFull.name = 'ValidationQueueFullError'
    poolRuns(getGeosWorkerPool, async () => {
      throw queueFull
    })

    await expect(
      validateGeoPackageLayers({ areas: [] }, 'baseline', { filePath: FILE })
    ).rejects.toThrow(/queue is full/)
  })

  it('prepends a distinctiveness error ahead of geometry errors', async () => {
    poolRuns(getGeosWorkerPool, async () => ({
      valid: false,
      errors: [{ code: ERROR_CODES.PARCEL_OVERLAPS, message: 'overlap' }]
    }))
    vi.mocked(checkHabitatDistinctiveness).mockReturnValueOnce({
      code: ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      message: 'out of scope',
      details: { count: 1, sample: [] }
    })

    const out = await validateGeoPackageLayers(
      { redline: [1], areas: [{}] },
      'baseline',
      { filePath: FILE }
    )

    expect(out.valid).toBe(false)
    expect(out.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      ERROR_CODES.PARCEL_OVERLAPS
    ])
  })

  it('flips valid → false when only the distinctiveness check fails', async () => {
    poolRuns(getGeosWorkerPool, async () => ({ valid: true, errors: [] }))
    vi.mocked(checkHabitatDistinctiveness).mockReturnValueOnce({
      code: ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE,
      message: 'out of scope',
      details: { count: 1, sample: [] }
    })

    const out = await validateGeoPackageLayers(
      { redline: [1], areas: [{}] },
      'baseline',
      { filePath: FILE }
    )

    expect(out.valid).toBe(false)
    expect(out.errors).toHaveLength(1)
  })
})
