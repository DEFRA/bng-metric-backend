import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { ERROR_CODES } from '../validation/baseline/errors.js'
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
  MOCK_BUFFER,
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
} from './baseline.test-fixtures.js'

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

vi.mock('../validation/baseline/geopackage.js', () => ({
  validateGpkg: vi.fn(),
  readBaselineGeoPackage: vi.fn()
}))

vi.mock('../validation/baseline/extract-habitat-data.js', () => ({
  extractHabitatData: vi.fn()
}))

vi.mock('../validation/baseline/assign-feature-ids.js', () => ({
  assignFeatureIds: vi.fn()
}))

vi.mock('../validation/baseline/index.js', () => ({
  validateBaselineLayers: vi.fn()
}))

vi.mock('../services/baseline/calculate-habitat-sizes.js', () => ({
  calculateHabitatSizes: vi.fn()
}))

vi.mock('../utilities/baseline/enrich-baseline-units.js', () => ({
  enrichBaselineDocumentWithUnits: vi.fn()
}))

// Preserve real error classes so instanceof checks in the handler work correctly
vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFile: vi.fn() }
})

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(),
  metricsByteSize: vi.fn()
}))

const { waitForUploadReady, UploadFailedError, UploadTimeoutError } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const { downloadFile, S3FileTooLargeError, S3TimeoutError, S3ConnectionError } =
  await import('../services/s3/download-file.js')
const { validateGpkg, readBaselineGeoPackage } =
  await import('../validation/baseline/geopackage.js')
const { assignFeatureIds } =
  await import('../validation/baseline/assign-feature-ids.js')
const { extractHabitatData } =
  await import('../validation/baseline/extract-habitat-data.js')
const { validateBaselineLayers } =
  await import('../validation/baseline/index.js')
const { calculateHabitatSizes } =
  await import('../services/baseline/calculate-habitat-sizes.js')
const { metricsCounter, metricsByteSize } =
  await import('../common/helpers/metrics.js')
const { validateBaseline, validatePostIntervention } =
  await import('./baseline.js')

describe('validateBaseline route configuration', () => {
  it('is a POST route', () => {
    expect(validateBaseline.method).toBe('POST')
  })

  it('has the correct path', () => {
    expect(validateBaseline.path).toBe('/baseline/validate/{uploadId}')
  })
})

describe('validatePostIntervention route configuration', () => {
  it('is a POST route for post-intervention uploads', () => {
    expect(validatePostIntervention.method).toBe('POST')
    expect(validatePostIntervention.path).toBe(
      '/post-intervention/validate/{uploadId}'
    )
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
  vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
  vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
  vi.mocked(readBaselineGeoPackage).mockReturnValue(STUB_LAYERS)
  vi.mocked(validateBaselineLayers).mockResolvedValue({
    valid: true,
    errors: []
  })
  vi.mocked(assignFeatureIds).mockReturnValue(STUB_LAYERS)
  vi.mocked(calculateHabitatSizes).mockResolvedValue(EMPTY_HABITAT_SIZES)
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
// (red line, habitats, hedgerows, watercourses) on the stub data.
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

    expect(downloadFile).not.toHaveBeenCalled()
    expect(validateBaselineLayers).not.toHaveBeenCalled()
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ code: ERROR_CODES.INVALID_FILE_METADATA })
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

    expect(downloadFile).toHaveBeenCalled()
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
    expect(waitForUploadReady).toHaveBeenCalledWith(UPLOAD_ID)
  })

  it('downloads the file using the resolved bucket and key', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(downloadFile).toHaveBeenCalledWith(MOCK_BUCKET, MOCK_KEY)
  })

  it('runs the gpkg gate against the downloaded buffer', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(validateGpkg).toHaveBeenCalledWith(MOCK_BUFFER)
  })

  it('runs full baseline validation when the gate passes', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(readBaselineGeoPackage).toHaveBeenCalled()
    expect(validateBaselineLayers).toHaveBeenCalledWith(
      STUB_LAYERS,
      undefined,
      'baseline'
    )
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
    vi.mocked(validateBaselineLayers).mockResolvedValue(result)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(result)
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
    vi.mocked(validateBaselineLayers).mockResolvedValue(result)
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
      ]
    }
    vi.mocked(validateGpkg).mockReturnValue(gateResult)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(gateResult)
    expect(validateBaselineLayers).not.toHaveBeenCalled()
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

  it('deletes prior baseline rows from all four feature tables before inserting', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(log.deletes).toHaveLength(4)
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

describe('validatePostIntervention handler persistence', () => {
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    setupHappyPathMocks()
  })

  it('persists the processed document and replaces post-intervention geometry rows', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })

    await validatePostIntervention.handler(request, h)

    expect(extractHabitatData).toHaveBeenCalledWith(STUB_LAYERS, {
      uploadId: UPLOAD_ID,
      filename: MOCK_FILENAME,
      fileSize: MOCK_FILE_SIZE,
      habitatSizes: EMPTY_HABITAT_SIZES,
      variant: 'postIntervention'
    })
    expect(log.transactionCalls).toBe(1)
    expect(log.selectCalls).toBe(1)
    expect(log.deletes).toHaveLength(4)
    expect(log.executes).toHaveLength(HAPPY_PATH_EXECUTE_COUNT)
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
    vi.mocked(validateBaselineLayers).mockResolvedValue({
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
    vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
    vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(readBaselineGeoPackage).mockReturnValue(STUB_LAYERS)
    vi.mocked(validateBaselineLayers).mockResolvedValue({
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

      expect(downloadFile).not.toHaveBeenCalled()
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
    vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(readBaselineGeoPackage).mockReturnValue(STUB_LAYERS)
    vi.mocked(validateBaselineLayers).mockResolvedValue({
      valid: true,
      errors: []
    })
  })

  describe('when downloadFile throws an S3FileTooLargeError', () => {
    it('throws a 413 Entity Too Large', async () => {
      vi.mocked(downloadFile).mockRejectedValue(
        new S3FileTooLargeError('too big')
      )

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_413)
      expect(err.message).toBe('File exceeds the maximum allowed size')
    })
  })

  describe('when downloadFile throws an S3TimeoutError', () => {
    it('throws a 504 Gateway Timeout', async () => {
      vi.mocked(downloadFile).mockRejectedValue(new S3TimeoutError('timed out'))

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_504)
      expect(err.message).toBe('Timed out downloading file from storage')
    })
  })

  describe('when downloadFile throws an S3ConnectionError', () => {
    it(THROWS_502, async () => {
      vi.mocked(downloadFile).mockRejectedValue(
        new S3ConnectionError('connection refused')
      )

      const err = await validateBaseline.handler(request, h).catch((e) => e)

      expect(err.isBoom).toBe(true)
      expect(err.output.statusCode).toBe(HTTP_502)
      expect(err.message).toBe('Unable to download file from storage')
    })
  })

  describe('when downloadFile throws an unexpected error', () => {
    it(THROWS_502, async () => {
      vi.mocked(downloadFile).mockRejectedValue(new Error('unexpected'))

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
    vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
    vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(readBaselineGeoPackage).mockReturnValue(STUB_LAYERS)
  })

  it('returns 500 when validateBaselineLayers throws', async () => {
    vi.mocked(validateBaselineLayers).mockRejectedValue(new Error('boom'))

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
    vi.mocked(validateGpkg).mockReturnValue({ valid: false, errors: ['bad'] })

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
    vi.mocked(validateBaselineLayers).mockResolvedValue({
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
