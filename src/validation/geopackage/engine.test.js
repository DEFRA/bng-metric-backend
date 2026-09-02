import { beforeEach, describe, expect, it, vi } from 'vitest'

const postgisResult = {
  valid: false,
  errors: [
    { code: 'PARCEL_OVERLAPS', message: 'overlaps', details: { count: 1 } }
  ]
}

vi.mock('./postgis/index.js', () => ({
  validateGeoPackageLayersPostgis: vi.fn(async () => postgisResult)
}))
vi.mock('./geos/worker-pool.js', () => ({
  getGeosWorkerPool: vi.fn(() => ({
    run: vi.fn(),
    stats: () => ({ size: 1, idle: 1, queued: 0 })
  }))
}))
vi.mock('../../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(async () => {}),
  metricsMillis: vi.fn(async () => {}),
  metricsGauge: vi.fn(async () => {}),
  metricsByteSize: vi.fn(async () => {})
}))

const { config } = await import('../../config.js')
const { runGeometryValidation } = await import('./engine.js')
const { validateGeoPackageLayersPostgis } = await import('./postgis/index.js')
const { getGeosWorkerPool } = await import('./geos/worker-pool.js')
const { metricsCounter } = await import('../../common/helpers/metrics.js')

const LAYERS = { redline: [], areas: [] }
const POOL = {}
const FILE = '/tmp/upload.gpkg'

/** Point the mocked pool at one behaviour for the length of a test. */
function poolRuns(implementation) {
  const run = vi.fn(implementation)
  getGeosWorkerPool.mockReturnValue({
    run,
    stats: () => ({ size: 1, idle: 1, queued: 0 })
  })
  return run
}

beforeEach(() => {
  vi.clearAllMocks()
  config.set('validation.engine', 'postgis')
})

describe('runGeometryValidation — postgis', () => {
  it('runs the SQL statement and never touches a worker', async () => {
    const run = poolRuns(async () => ({ valid: true, errors: [] }))
    const result = await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE
    })
    expect(result).toBe(postgisResult)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('runGeometryValidation — geos', () => {
  beforeEach(() => config.set('validation.engine', 'geos'))

  it('runs the file on a worker and returns its verdict', async () => {
    const geosResult = { valid: true, errors: [], sizes: { areas: [] } }
    const run = poolRuns(async () => geosResult)
    const result = await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE,
      includeSizes: true
    })
    expect(run).toHaveBeenCalledWith(FILE, { includeSizes: true })
    expect(result).toBe(geosResult)
    expect(validateGeoPackageLayersPostgis).not.toHaveBeenCalled()
  })

  it('falls back to PostGIS when the queue is full, and counts it', async () => {
    const full = new Error('full')
    full.name = 'ValidationQueueFullError'
    poolRuns(async () => {
      throw full
    })
    const result = await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE
    })
    expect(result).toBe(postgisResult)
    expect(metricsCounter).toHaveBeenCalledWith(
      'GeoPackageValidationEngineFallback',
      1,
      { reason: 'queue_full' }
    )
  })

  it('falls back to PostGIS when a worker fails, and counts it separately', async () => {
    poolRuns(async () => {
      throw new Error('worker exited')
    })
    const result = await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE
    })
    expect(result).toBe(postgisResult)
    expect(metricsCounter).toHaveBeenCalledWith(
      'GeoPackageValidationEngineFallback',
      1,
      { reason: 'worker_failed' }
    )
  })

  it('falls back to PostGIS when no file path was threaded through', async () => {
    const run = poolRuns(async () => ({ valid: true, errors: [] }))
    const result = await runGeometryValidation({ layers: LAYERS, pool: POOL })
    expect(run).not.toHaveBeenCalled()
    expect(result).toBe(postgisResult)
    expect(metricsCounter).toHaveBeenCalledWith(
      'GeoPackageValidationEngineFallback',
      1,
      { reason: 'no_file_path' }
    )
  })
})

describe('runGeometryValidation — shadow', () => {
  beforeEach(() => config.set('validation.engine', 'shadow'))

  it('returns the PostGIS answer even when GEOS agrees', async () => {
    poolRuns(async () => structuredClone(postgisResult))
    const result = await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE
    })
    expect(result).toBe(postgisResult)
    expect(metricsCounter).not.toHaveBeenCalledWith(
      'GeoPackageValidationEngineDivergence',
      expect.anything(),
      expect.anything()
    )
  })

  it('returns the PostGIS answer and counts the divergence when they disagree', async () => {
    poolRuns(async () => ({ valid: true, errors: [] }))
    const result = await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE
    })
    expect(result).toBe(postgisResult)
    expect(metricsCounter).toHaveBeenCalledWith(
      'GeoPackageValidationEngineDivergence',
      1,
      { kind: 'codes' }
    )
  })

  it('never asks the worker for sizes — shadow must not change what is persisted', async () => {
    const run = poolRuns(async () => structuredClone(postgisResult))
    await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE,
      includeSizes: true
    })
    expect(run).toHaveBeenCalledWith(FILE, { includeSizes: false })
  })

  it('still returns the PostGIS answer when the shadow run fails outright', async () => {
    poolRuns(async () => {
      throw new Error('worker exited')
    })
    const result = await runGeometryValidation({
      layers: LAYERS,
      pool: POOL,
      filePath: FILE
    })
    expect(result).toBe(postgisResult)
  })
})
