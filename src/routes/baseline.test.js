import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { ERROR_CODES } from '../validation/geopackage/errors.js'
import { ValidationQueueFullError } from '../validation/geopackage/geos/worker-pool.js'
import {
  getParseBudget,
  resetParseBudget
} from '../validation/geopackage/parse-budget.js'
import { config } from '../config.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_CATEGORY
} from '../common/helpers/metric-names.js'
import {
  UPLOAD_ID,
  PROJECT_ID,
  SUB,
  MOCK_BUCKET,
  MOCK_KEY,
  MOCK_FILENAME,
  MOCK_FILE_SIZE,
  MOCK_DOWNLOAD_PATH,
  makeDownload,
  THROWS_502,
  HTTP_404,
  HTTP_409,
  HTTP_422,
  HTTP_502,
  HTTP_504,
  HTTP_413,
  STUB_LAYERS,
  STUB_EXTRACTED,
  makeH,
  makeDrizzle
} from './validate-geopackage-route.test-fixtures.js'

vi.mock('../services/cdp-uploader/cdp-uploader.js', () => ({
  waitForUploadReady: vi.fn(),
  UploadFailedError: class MockUploadFailedError extends Error {
    constructor(message, errorMessage = null) {
      super(message)
      this.name = 'UploadFailedError'
      this.errorMessage = errorMessage
    }
  },
  UploadTimeoutError: class MockUploadTimeoutError extends Error {
    constructor(message) {
      super(message)
      this.name = 'UploadTimeoutError'
    }
  }
}))

vi.mock('../validation/geopackage/geopackage.js', () => ({
  // The gate no longer unpacks: it answers valid/invalid from the file, and the
  // shapes are read separately once a worker is free.
  validateGpkgFile: vi.fn(),
  readGeoPackage: vi.fn()
}))

vi.mock('../validation/geopackage/baseline/extract-habitat-data.js', () => ({
  extractHabitatData: vi.fn()
}))

vi.mock(
  '../validation/geopackage/post-intervention/extract-post-intervention.js',
  () => ({
    extractPostIntervention: vi.fn(),
    filterLostPostInterventionLayers: vi.fn((layers) => layers)
  })
)

vi.mock(
  '../utilities/enrichment/post-intervention/enrich-post-intervention-units.js',
  () => ({
    enrichPostInterventionDocumentWithUnits: vi.fn()
  })
)

vi.mock('../validation/geopackage/assign-feature-ids.js', () => ({
  assignFeatureIds: vi.fn()
}))

vi.mock('../validation/geopackage/index.js', () => ({
  validateGeoPackageLayers: vi.fn()
}))

// Partial mock: `calculateHabitatSizes` is stubbed, but `attachGeometrySizes`
// is the real one, so the size-stamping the save path now does is exercised
// rather than replaced.
vi.mock(
  '../services/upload/calculate-habitat-sizes.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    calculateHabitatSizes: vi.fn()
  })
)

vi.mock('../utilities/enrichment/baseline/enrich-baseline-units.js', () => ({
  enrichBaselineDocumentWithUnits: vi.fn()
}))

// Preserve real error classes so instanceof checks in the handler work correctly
vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFileToTemp: vi.fn() }
})

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(),
  metricsByteSize: vi.fn(),
  metricsMillis: vi.fn(),
  metricsGauge: vi.fn()
}))

const { waitForUploadReady, UploadFailedError, UploadTimeoutError } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const {
  downloadFileToTemp,
  S3FileTooLargeError,
  S3TimeoutError,
  S3ConnectionError
} = await import('../services/s3/download-file.js')
const { validateGpkgFile, readGeoPackage } =
  await import('../validation/geopackage/geopackage.js')
const { assignFeatureIds } =
  await import('../validation/geopackage/assign-feature-ids.js')
const { extractHabitatData } =
  await import('../validation/geopackage/baseline/extract-habitat-data.js')
const { validateGeoPackageLayers } =
  await import('../validation/geopackage/index.js')
const { calculateHabitatSizes } =
  await import('../services/upload/calculate-habitat-sizes.js')
const { metricsCounter, metricsByteSize, metricsGauge, metricsMillis } =
  await import('../common/helpers/metrics.js')
const { validateBaseline } = await import('./baseline.js')

describe('validateBaseline route configuration', () => {
  it('is a POST route', () => {
    expect(validateBaseline.method).toBe('POST')
  })

  it('has the correct path', () => {
    expect(validateBaseline.path).toBe('/baseline/validate/{uploadId}')
  })
})

describe('validateBaseline Joi param validation', () => {
  const schema = validateBaseline.options.validate.params

  it('accepts a valid UUID uploadId', () => {
    const { error } = schema.validate({ uploadId: UPLOAD_ID })
    expect(error).toBeUndefined()
  })

  it('rejects a non-UUID uploadId', () => {
    const { error } = schema.validate({ uploadId: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"uploadId" must be a valid GUID/)
  })

  it('rejects a missing uploadId', () => {
    const { error } = schema.validate({})
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"uploadId" is required/)
  })
})

describe('validateBaseline Joi payload validation', () => {
  const schema = validateBaseline.options.validate.payload

  it('accepts a missing payload', () => {
    const { error } = schema.validate(undefined)
    expect(error).toBeUndefined()
  })

  it('accepts a null payload', () => {
    const { error } = schema.validate(null)
    expect(error).toBeUndefined()
  })

  it('accepts a payload with a valid projectId', () => {
    const { error } = schema.validate({ projectId: PROJECT_ID })
    expect(error).toBeUndefined()
  })

  it('rejects a payload with a non-UUID projectId', () => {
    const { error } = schema.validate({ projectId: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"projectId" must be a valid GUID/)
  })
})

function setupHappyPathMocks() {
  vi.mocked(waitForUploadReady).mockResolvedValue({
    bucket: MOCK_BUCKET,
    key: MOCK_KEY,
    filename: MOCK_FILENAME,
    fileSize: MOCK_FILE_SIZE
  })
  vi.mocked(downloadFileToTemp).mockResolvedValue(makeDownload())
  vi.mocked(validateGpkgFile).mockReturnValue({ valid: true, errors: [] })
  vi.mocked(readGeoPackage).mockReturnValue(STUB_LAYERS)
  // Honours the real contract: when handed a loader rather than layers, the
  // pool calls it once a worker is free. A double that ignored the loader
  // would let a route that never unpacks its file still pass.
  vi.mocked(validateGeoPackageLayers).mockImplementation(
    async (layersOrLoad) => {
      if (typeof layersOrLoad === 'function') {
        layersOrLoad()
      }
      return { valid: true, errors: [] }
    }
  )
  vi.mocked(assignFeatureIds).mockReturnValue(STUB_LAYERS)
  vi.mocked(calculateHabitatSizes).mockReturnValue(EMPTY_HABITAT_SIZES)
  vi.mocked(extractHabitatData).mockReturnValue(STUB_EXTRACTED)
}

function makeBaselineRequest({ drizzle, payload = null, sub = SUB } = {}) {
  return {
    params: { uploadId: UPLOAD_ID },
    payload,
    drizzle,
    auth: { credentials: { sub } }
  }
}

// One SET LOCAL lock_timeout + one INSERT per non-empty geometry layer
// (red line, habitats, hedgerows, watercourses) on the stub data. The stub
// carries no individual trees, so the trees table is deleted but not inserted.
const HAPPY_PATH_EXECUTE_COUNT = 5

const EMPTY_HABITAT_SIZES = {
  areaHabitats: {
    individualSquareMetres: [],
    totalSquareMetres: 0
  },
  hedgerows: {
    individualMetres: [],
    totalMetres: 0
  },
  watercourses: {
    individualMetres: [],
    totalMetres: 0
  }
}

describe('validateBaseline handler — upload metadata early rejection', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
  })

  it('rejects before downloading when filename exceeds max length and projectId is present', async () => {
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: MOCK_BUCKET,
      key: MOCK_KEY,
      filename: 'a'.repeat(256) + '.gpkg',
      fileSize: MOCK_FILE_SIZE
    })

    await validateBaseline.handler(
      makeBaselineRequest({
        drizzle: drizzleHarness.drizzle,
        payload: { projectId: PROJECT_ID }
      }),
      h
    )

    expect(downloadFileToTemp).not.toHaveBeenCalled()
    expect(validateGeoPackageLayers).not.toHaveBeenCalled()
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ code: ERROR_CODES.INVALID_FILENAME })
        ])
      })
    )
  })

  it('does not reject early when projectId is absent, even with an invalid filename', async () => {
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: MOCK_BUCKET,
      key: MOCK_KEY,
      filename: 'a'.repeat(256) + '.gpkg',
      fileSize: MOCK_FILE_SIZE
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(downloadFileToTemp).toHaveBeenCalled()
  })
})

describe('validateBaseline handler — pipeline calls', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
  })

  it('waits for the upload to be ready using the uploadId', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(waitForUploadReady).toHaveBeenCalledWith(UPLOAD_ID, {
      timeoutMs: expect.any(Number)
    })
  })

  it('downloads the file using the resolved bucket and key', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(downloadFileToTemp).toHaveBeenCalledWith(MOCK_BUCKET, MOCK_KEY, {
      timeoutMs: expect.any(Number)
    })
  })

  it('runs the gpkg gate against the downloaded file', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(validateGpkgFile).toHaveBeenCalledWith(MOCK_DOWNLOAD_PATH)
  })

  // The gate and the unpack are now two reads of the same file, where BMD-910
  // had deliberately made them one. That is a knowing trade: the second read
  // costs ~14 ms of SQLite fetch on a 5,000-parcel file, and it buys not
  // holding 57 MB of unpacked shapes for the whole time the request waits for
  // a worker. Memory was the scarcer resource.
  it('hands the pool a loader, not layers, so the wait costs a path', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(validateGpkgFile).toHaveBeenCalledTimes(1)
    expect(validateGeoPackageLayers).toHaveBeenCalledWith(
      expect.any(Function),
      'baseline',
      { filePath: MOCK_DOWNLOAD_PATH, includeSizes: false }
    )
  })

  // The property the whole reorder exists for. If the file were unpacked before
  // the pool were consulted, every queued request would be holding its shapes
  // again and the change would have bought nothing.
  it('does not unpack the file until the pool asks for it', async () => {
    let unpackedBeforePool = true
    vi.mocked(validateGeoPackageLayers).mockImplementation(
      async (layersOrLoad) => {
        unpackedBeforePool = vi.mocked(readGeoPackage).mock.calls.length > 0
        layersOrLoad()
        return { valid: true, errors: [] }
      }
    )

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(unpackedBeforePool).toBe(false)
    expect(readGeoPackage).toHaveBeenCalledWith(MOCK_DOWNLOAD_PATH)
  })
})

// A full validation queue is the one rejection that is not about the user's
// file. It has to come back as a 503 with a Retry-After, so the frontend can
// say "try again" rather than sending someone off to re-draw good polygons.
describe('validateBaseline handler — service busy', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
    const queueFull = new Error('Geometry validation queue is full (8 waiting)')
    queueFull.name = 'ValidationQueueFullError'
    Object.setPrototypeOf(queueFull, ValidationQueueFullError.prototype)
    vi.mocked(validateGeoPackageLayers).mockRejectedValue(queueFull)
  })

  it('answers 503 rather than 500 when every worker is busy', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.code).toHaveBeenCalledWith(503)
  })

  it('reports VALIDATION_BUSY, not a validation failure', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith({
      valid: false,
      errors: [expect.objectContaining({ code: ERROR_CODES.VALIDATION_BUSY })]
    })
  })

  // The frontend paces its polling from this header, so it is load-bearing
  // rather than decoration: it must carry the configured value, not a constant.
  it('tells the caller when to come back, from config', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.header).toHaveBeenCalledWith(
      'Retry-After',
      String(config.get('validation.busyRetryAfterSeconds'))
    )
  })

  it('counts the refusal with the reason, so the remedy is distinguishable', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsCounter).toHaveBeenCalledWith('GeoPackageValidationBusy', 1, {
      reason: 'queue_full'
    })
  })

  it('does not count it as a validation failure — the file was never read', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsCounter).not.toHaveBeenCalledWith(
      'GeoPackageValidationFailed',
      expect.anything(),
      expect.anything()
    )
  })

  it('does not persist anything', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({
        drizzle: drizzleHarness.drizzle,
        payload: { projectId: PROJECT_ID }
      }),
      h
    )
    expect(drizzleHarness.log.transactionCalls).toBe(0)
  })
})

// The other way the service can be too busy, and the one the pool cannot see:
// worker slots free, but the files already parsed leave no heap to parse
// another. Refused BEFORE the download, so a turned-away request costs nothing
// — which is the entire point of deciding from the size rather than after the
// read.
describe('validateBaseline handler — parse budget exhausted', () => {
  let h
  let drizzleHarness
  let release

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
    resetParseBudget()
    // One enormous reservation fills the budget: the first file in is always
    // admitted however big it is, so nothing else fits behind it.
    const budgetBytes = config.get('validation.parseBudgetBytes')
    release = getParseBudget(budgetBytes).reserve(budgetBytes)
  })

  afterEach(() => {
    release()
    resetParseBudget()
  })

  it('answers 503 rather than running the validation anyway', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.code).toHaveBeenCalledWith(503)
    expect(h.response).toHaveBeenCalledWith({
      valid: false,
      errors: [expect.objectContaining({ code: ERROR_CODES.VALIDATION_BUSY })]
    })
  })

  // The saving is the whole feature: refusing after the download and parse
  // costs exactly as much memory as accepting, which is why the existing
  // post-parse limit protected nothing.
  it('refuses without downloading or parsing the file', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(downloadFileToTemp).not.toHaveBeenCalled()
    expect(validateGpkgFile).not.toHaveBeenCalled()
    expect(validateGeoPackageLayers).not.toHaveBeenCalled()
  })

  it('tells the caller when to come back, from config', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.header).toHaveBeenCalledWith(
      'Retry-After',
      String(config.get('validation.busyRetryAfterSeconds'))
    )
  })

  // A refusal for memory and a refusal for a full queue have different
  // remedies — more heap versus more workers — so the metric has to tell them
  // apart, or the dashboard says "busy" and nothing more.
  it('counts the refusal against memory, not the queue', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsCounter).toHaveBeenCalledWith('GeoPackageValidationBusy', 1, {
      reason: 'memory_budget'
    })
  })

  it('does not count it as a validation failure — the file was never read', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsCounter).not.toHaveBeenCalledWith(
      'GeoPackageValidationFailed',
      expect.anything(),
      expect.anything()
    )
  })

  it('does not persist anything', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({
        drizzle: drizzleHarness.drizzle,
        payload: { projectId: PROJECT_ID }
      }),
      h
    )
    expect(drizzleHarness.log.transactionCalls).toBe(0)
  })
})

// A budget that is taken but never given back would refuse everything after
// the first few files, which is worse than not having one — so the release is
// worth pinning down on both the success and the failure path.
describe('validateBaseline handler — parse budget accounting', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
    resetParseBudget()
  })

  afterEach(() => {
    resetParseBudget()
  })

  function budget() {
    return getParseBudget(config.get('validation.parseBudgetBytes'))
  }

  it('holds the file for the length of the validation and no longer', async () => {
    let inFlightDuringParse = 0
    vi.mocked(readGeoPackage).mockImplementation(() => {
      inFlightDuringParse = budget().inFlightBytes
      return { valid: true, errors: [], layers: STUB_LAYERS }
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(inFlightDuringParse).toBeGreaterThan(0)
    expect(budget().inFlightBytes).toBe(0)
  })

  // The gap between the advisory check and the reservation is real: another
  // request can take the last of the budget while this one is still streaming
  // its file out of S3. The reservation re-checks for exactly that, and the
  // answer has to be the same 503 rather than an unhandled error.
  it('still refuses when the budget goes while the file is downloading', async () => {
    vi.mocked(downloadFileToTemp).mockImplementation(async () => {
      budget().reserve(config.get('validation.parseBudgetBytes'))
      return makeDownload()
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(h.code).toHaveBeenCalledWith(503)
    expect(validateGpkgFile).not.toHaveBeenCalled()
    expect(metricsCounter).toHaveBeenCalledWith('GeoPackageValidationBusy', 1, {
      reason: 'memory_budget'
    })
  })

  it('gives the budget back when the validation throws', async () => {
    vi.mocked(readGeoPackage).mockImplementation(() => {
      throw new Error('gpkg gate exploded')
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(budget().inFlightBytes).toBe(0)
  })
})

// The leading indicators for the worker pool. GeoPackageValidationBusy only
// moves once users are already being turned away; these start climbing before
// that, and the memory figure is what says whether more workers are an option.
describe('validateBaseline handler — worker pool telemetry', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: true,
      errors: [],
      poolTelemetry: { queueWaitMs: 42, queueDepth: 3 }
    })
  })

  it('records how long the validation waited for a worker', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsMillis).toHaveBeenCalledWith(
      'UploadValidationQueueWaitMs',
      42,
      { documentKey: 'baseline' }
    )
  })

  it('records how deep the queue was', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsGauge).toHaveBeenCalledWith('ValidationWorkerQueueDepth', 3)
  })

  // The open question on this rollout is whether the ECS task can hold the
  // workers it is configured for. Without this metric that is unobservable.
  it('records resident memory, which is what bounds the worker count', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsGauge).toHaveBeenCalledWith(
      'BackendProcessResidentMb',
      expect.any(Number)
    )
  })

  it('skips the pool metrics when there is no telemetry to report', async () => {
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: true,
      errors: []
    })
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsGauge).not.toHaveBeenCalledWith(
      'ValidationWorkerQueueDepth',
      expect.anything()
    )
  })
})

// The download is a file on disk now, not a Buffer in memory, so
// the handler owns removing it however the request ends.
describe('validateBaseline handler — downloaded file cleanup', () => {
  let h
  let drizzleHarness
  let download

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
    download = makeDownload()
    vi.mocked(downloadFileToTemp).mockResolvedValue(download)
  })

  it('removes the temporary file after a successful validation', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(download.cleanup).toHaveBeenCalledTimes(1)
  })

  it('removes the temporary file when the gate rejects the file', async () => {
    vi.mocked(validateGpkgFile).mockReturnValue({
      valid: false,
      errors: [{ code: ERROR_CODES.GPKG_INVALID_FILE, message: 'nope' }],
      layers: null
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(download.cleanup).toHaveBeenCalledTimes(1)
  })

  it('still answers the request when the file cannot be removed', async () => {
    download.cleanup.mockRejectedValue(new Error('EACCES'))

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true })
    )
  })

  it('removes the temporary file when validation throws', async () => {
    vi.mocked(readGeoPackage).mockImplementation(() => {
      throw new Error('boom')
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(download.cleanup).toHaveBeenCalledTimes(1)
  })
})

describe('validateBaseline handler — response shape', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
  })

  it('returns the baseline validation result when valid', async () => {
    const result = { valid: true, errors: [] }
    vi.mocked(validateGeoPackageLayers).mockResolvedValue(result)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(result)
  })

  // The verdict carries more than the wire contract: `sizes` feeds persistence
  // and `poolTelemetry` feeds the metrics. Neither belongs in the body — sizes
  // are an implementation detail of storage, and queue depth describes this
  // instance's load rather than the user's file. Asserted on the exact object so
  // a field added to the result cannot become part of the API by accident.
  it('answers with the verdict alone, not the internals measured alongside it', async () => {
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: true,
      errors: [],
      sizes: { areas: [{ idx: 0, value: 675.28 }] },
      poolTelemetry: { queueWaitMs: 42, queueDepth: 3 }
    })
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith({ valid: true, errors: [] })
  })

  it('returns the baseline validation result when invalid', async () => {
    const result = {
      valid: false,
      errors: [
        {
          code: 'REDLINE_INVALID_GEOMETRY',
          message: 'Redline boundary geometry is invalid'
        }
      ]
    }
    vi.mocked(validateGeoPackageLayers).mockResolvedValue(result)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(result)
  })

  it('returns the gate result and skips full validation when the gate fails', async () => {
    const gateResult = {
      valid: false,
      errors: [
        'Missing required feature layer in GeoPackage: Red Line Boundary'
      ],
      layers: null
    }
    vi.mocked(validateGpkgFile).mockReturnValue(gateResult)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith({
      valid: false,
      errors: gateResult.errors
    })
    expect(validateGeoPackageLayers).not.toHaveBeenCalled()
  })
})

describe('validateBaseline handler persistence — happy path side effects', () => {
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    setupHappyPathMocks()
  })

  it('opens a transaction when projectId is supplied and validation passes', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(extractHabitatData).toHaveBeenCalledWith(STUB_LAYERS, {
      uploadId: UPLOAD_ID,
      filename: MOCK_FILENAME,
      fileSize: MOCK_FILE_SIZE,
      habitatSizes: EMPTY_HABITAT_SIZES,
      variant: 'baseline'
    })
    expect(log.transactionCalls).toBe(1)
  })

  it('checks the project exists at the start of the transaction', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(log.selectCalls).toBe(1)
  })

  it('AC3/AC4 deletes prior baseline and post-intervention feature rows before inserting', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(log.deletes).toHaveLength(10)
  })

  it('inserts geometry rows for each non-empty layer', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(log.executes).toHaveLength(HAPPY_PATH_EXECUTE_COUNT)
  })

  it('updates the project JSONB document at the end of the transaction', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(log.updates).toHaveLength(1)
  })
})

describe('validateBaseline handler persistence guard rails', () => {
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    setupHappyPathMocks()
  })
  it('does not call extractHabitatData or open a transaction when no projectId is supplied', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({ drizzle, payload: null })
    await validateBaseline.handler(request, h)
    expect(extractHabitatData).not.toHaveBeenCalled()
    expect(log.transactionCalls).toBe(0)
  })

  it('does not persist when projectId is supplied but validation fails', async () => {
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: false,
      errors: [{ code: 'REDLINE_INVALID_GEOMETRY', message: 'bad' }]
    })
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(extractHabitatData).not.toHaveBeenCalled()
    expect(log.transactionCalls).toBe(0)
  })

  it('throws a 404 Boom error when the projectId does not match an existing project', async () => {
    const { drizzle } = makeDrizzle({ projectExists: false })
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    const err = await validateBaseline.handler(request, h).catch((e) => e)
    expect(err.isBoom).toBe(true)
    expect(err.output.statusCode).toBe(HTTP_404)
  })

  it('does not insert any geometry rows when the project is missing', async () => {
    const { drizzle, log } = makeDrizzle({ projectExists: false })
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h).catch(() => {})
    // SET LOCAL lock_timeout runs before the project lookup, so 1 execute but no inserts
    expect(log.executes).toHaveLength(1)
    expect(log.updates).toHaveLength(0)
  })

  it('scopes persistence to the authenticated user — threads the token sub into the project lock', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID },
      sub: 'specific-user-sub'
    })
    await validateBaseline.handler(request, h)
    expect(log.projectWhere).toHaveLength(1)
    // The lock predicate must carry THIS user's sub (visibleToUser), so the
    // write can only touch a project the signed-in user may act on.
    const { params } = new PgDialect().sqlToQuery(log.projectWhere[0])
    expect(params).toContain('specific-user-sub')
  })
})

describe('validateBaseline handler persistence — lock contention and rollback', () => {
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    setupHappyPathMocks()
  })

  it('throws a 409 Boom error when the project row lock cannot be acquired within lock_timeout', async () => {
    const lockError = Object.assign(
      new Error('canceling statement due to lock timeout'),
      {
        code: '55P03'
      }
    )
    const { drizzle, log } = makeDrizzle({ lockError })
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    const err = await validateBaseline.handler(request, h).catch((e) => e)
    expect(err.isBoom).toBe(true)
    expect(err.output.statusCode).toBe(HTTP_409)
    expect(log.executes).toHaveLength(1) // just the SET LOCAL lock_timeout
    expect(log.updates).toHaveLength(0)
  })

  // Regression guard: the JSONB document write must live inside the same
  // transaction as the geometry inserts. If an insert throws, the doc update
  // must never fire. Catches anyone later refactoring the update outside the
  // transaction.
  it('does not write the project document when an insert throws', async () => {
    const { drizzle, tx, log } = makeDrizzle()
    // First execute is SET LOCAL lock_timeout — let it succeed, then reject the
    // first geometry INSERT to simulate a mid-import failure.
    tx.execute
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error('bad geom')))
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(log.transactionCalls).toBe(1)
    expect(log.updates).toHaveLength(0)
  })
})

describe('validateBaseline handler upload error handling', () => {
  const request = {
    params: { uploadId: UPLOAD_ID },
    payload: null,
    auth: { credentials: { sub: SUB } }
  }
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    vi.mocked(downloadFileToTemp).mockResolvedValue(makeDownload())
    vi.mocked(validateGpkgFile).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(readGeoPackage).mockReturnValue(STUB_LAYERS)
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: true,
      errors: []
    })
  })

  describe('when waitForUploadReady throws an UploadTimeoutError', () => {
    it('throws a 504 Gateway Timeout', async () => {
      vi.mocked(waitForUploadReady).mockRejectedValue(
        new UploadTimeoutError('timed out')
      )

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_504)
      expect(err.message).toBe('Upload did not complete in time')
    })
  })

  describe('when waitForUploadReady throws an UploadFailedError', () => {
    it('throws a 422 Unprocessable Entity', async () => {
      vi.mocked(waitForUploadReady).mockRejectedValue(
        new UploadFailedError('rejected')
      )

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_422)
      expect(err.message).toBe('Upload was rejected')
    })
  })

  describe('when waitForUploadReady throws an unexpected error', () => {
    it(THROWS_502, async () => {
      vi.mocked(waitForUploadReady).mockRejectedValue(new Error('unexpected'))

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_502)
    })

    it('does not attempt to download the file', async () => {
      vi.mocked(waitForUploadReady).mockRejectedValue(
        new Error('Upload not ready')
      )

      await validateBaseline.handler(request, h).catch(() => {})

      expect(downloadFileToTemp).not.toHaveBeenCalled()
    })
  })
})

describe('validateBaseline handler download error handling', () => {
  const request = {
    params: { uploadId: UPLOAD_ID },
    payload: null,
    auth: { credentials: { sub: SUB } }
  }
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: MOCK_BUCKET,
      key: MOCK_KEY
    })
    vi.mocked(validateGpkgFile).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(readGeoPackage).mockReturnValue(STUB_LAYERS)
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: true,
      errors: []
    })
  })

  describe('when downloadFileToTemp throws an S3FileTooLargeError', () => {
    it('throws a 413 Entity Too Large', async () => {
      vi.mocked(downloadFileToTemp).mockRejectedValue(
        new S3FileTooLargeError('too big')
      )

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_413)
      expect(err.message).toBe('File exceeds the maximum allowed size')
    })
  })

  describe('when downloadFileToTemp throws an S3TimeoutError', () => {
    it('throws a 504 Gateway Timeout', async () => {
      vi.mocked(downloadFileToTemp).mockRejectedValue(
        new S3TimeoutError('timed out')
      )

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_504)
      expect(err.message).toBe('Timed out downloading file from storage')
    })
  })

  describe('when downloadFileToTemp throws an S3ConnectionError', () => {
    it(THROWS_502, async () => {
      vi.mocked(downloadFileToTemp).mockRejectedValue(
        new S3ConnectionError('connection refused')
      )

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_502)
      expect(err.message).toBe('Unable to download file from storage')
    })
  })

  describe('when downloadFileToTemp throws an unexpected error', () => {
    it(THROWS_502, async () => {
      vi.mocked(downloadFileToTemp).mockRejectedValue(new Error('unexpected'))

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_502)
    })
  })
})

describe('validateBaseline handler full validation error handling', () => {
  const request = {
    params: { uploadId: UPLOAD_ID },
    payload: null,
    auth: { credentials: { sub: SUB } }
  }
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: MOCK_BUCKET,
      key: MOCK_KEY
    })
    vi.mocked(downloadFileToTemp).mockResolvedValue(makeDownload())
    vi.mocked(validateGpkgFile).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(readGeoPackage).mockReturnValue(STUB_LAYERS)
  })

  it('returns 500 when validateGeoPackageLayers throws', async () => {
    vi.mocked(validateGeoPackageLayers).mockRejectedValue(new Error('boom'))

    await validateBaseline.handler(request, h)

    expect(h.code).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        errors: [expect.objectContaining({ code: 'VALIDATION_FAILED' })]
      })
    )
  })
})

describe('validateBaseline handler — metrics', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
  })

  it('emits the upload size and a success counter when validation passes', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(metricsByteSize).toHaveBeenCalledWith(
      GEOPACKAGE_METRIC.uploadSizeBytes,
      MOCK_FILE_SIZE
    )
    expect(metricsCounter).toHaveBeenCalledWith(
      GEOPACKAGE_METRIC.validationSucceeded
    )
  })

  it('emits an internal_data failure when the gpkg gate rejects', async () => {
    vi.mocked(validateGpkgFile).mockReturnValue({
      valid: false,
      errors: ['bad'],
      layers: null
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(metricsCounter).toHaveBeenCalledWith(
      GEOPACKAGE_METRIC.validationFailed,
      1,
      { category: VALIDATION_CATEGORY.internalData }
    )
    expect(metricsCounter).not.toHaveBeenCalledWith(
      GEOPACKAGE_METRIC.validationSucceeded
    )
  })

  it('emits a geometric failure when full validation rejects', async () => {
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: false,
      errors: [{ code: 'REDLINE_INVALID_GEOMETRY', message: 'bad' }]
    })

    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )

    expect(metricsCounter).toHaveBeenCalledWith(
      GEOPACKAGE_METRIC.validationFailed,
      1,
      { category: VALIDATION_CATEGORY.geometric }
    )
  })

  // NOTE: the virus *metric* is asserted in routes/upload.test.js — it is emitted
  // from the /upload/{uploadId}/status route, the chokepoint the frontend polls.
  // The validate route is never called for a rejected upload, so it no longer
  // emits the virus metric (it still returns 422 — see the UploadFailedError
  // handling tests above).
})
