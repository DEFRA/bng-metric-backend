import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

vi.mock('../services/cdp-uploader/cdp-uploader.js', () => ({
  waitForUploadReady: vi.fn(),
  UploadFailedError: class MockUploadFailedError extends Error {
    constructor(message) {
      super(message)
      this.name = 'UploadFailedError'
    }
  },
  UploadTimeoutError: class MockUploadTimeoutError extends Error {
    constructor(message) {
      super(message)
      this.name = 'UploadTimeoutError'
    }
  }
}))

vi.mock('../services/gpkg/validate-gpkg.js', () => ({
  validateGpkg: vi.fn()
}))

vi.mock('../services/gpkg/extract-baseline.js', () => ({
  extractBaseline: vi.fn()
}))

vi.mock('../validation/baseline/geopackage.js', () => ({
  readBaselineGeoPackage: vi.fn()
}))

vi.mock('../validation/baseline/index.js', () => ({
  validateBaselineLayers: vi.fn()
}))

// Preserve real error classes so instanceof checks in the handler work correctly
vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFile: vi.fn() }
})

const { waitForUploadReady, UploadFailedError, UploadTimeoutError } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const { downloadFile, S3FileTooLargeError, S3TimeoutError, S3ConnectionError } =
  await import('../services/s3/download-file.js')
const { validateGpkg } = await import('../services/gpkg/validate-gpkg.js')
const { extractBaseline } = await import('../services/gpkg/extract-baseline.js')
const { readBaselineGeoPackage } =
  await import('../validation/baseline/geopackage.js')
const { validateBaselineLayers } =
  await import('../validation/baseline/index.js')
const { validateBaseline } = await import('./baseline.js')

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const FEATURE_ID_RED = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const FEATURE_ID_HAB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const FEATURE_ID_HEDGE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const FEATURE_ID_WATER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

const MOCK_BUCKET = 'baseline-files'
const MOCK_KEY = 'baseline/file.gpkg'
const MOCK_BUFFER = Buffer.from('mock-gpkg-data')
const THROWS_502 = 'throws a 502 Bad Gateway'

const HTTP_404 = 404
const HTTP_422 = 422
const HTTP_502 = 502
const HTTP_504 = 504
const HTTP_413 = 413

const STUB_LAYERS = {
  redline: [],
  areas: [],
  hedgerows: [],
  watercourses: [],
  iggis: [],
  trees: [],
  missingLayers: []
}

const SAMPLE_GEOM = { type: 'Polygon', coordinates: [[[0, 0]]] }
const SAMPLE_LINE = { type: 'LineString', coordinates: [[0, 0]] }

const STUB_EXTRACTED = {
  document: {
    uploadId: UPLOAD_ID,
    importedAt: '2026-05-08T00:00:00.000Z',
    redLine: { featureId: FEATURE_ID_RED, properties: {} },
    habitats: [{ featureId: FEATURE_ID_HAB, ref: 'P1' }],
    hedgerows: [{ featureId: FEATURE_ID_HEDGE, ref: 'H1' }],
    watercourses: [{ featureId: FEATURE_ID_WATER, ref: 'W1' }]
  },
  geometries: {
    redLine: { featureId: FEATURE_ID_RED, geometry: SAMPLE_GEOM, srid: 27700 },
    habitats: [
      {
        featureId: FEATURE_ID_HAB,
        ref: 'P1',
        geometry: SAMPLE_GEOM,
        srid: 27700
      }
    ],
    hedgerows: [
      {
        featureId: FEATURE_ID_HEDGE,
        ref: 'H1',
        geometry: SAMPLE_LINE,
        srid: 27700
      }
    ],
    watercourses: [
      {
        featureId: FEATURE_ID_WATER,
        ref: 'W1',
        geometry: SAMPLE_LINE,
        srid: 27700
      }
    ]
  }
}

function makeH() {
  return {
    response: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis()
  }
}

/**
 * Build a drizzle test double whose .transaction(cb) calls cb with a tx object
 * that recordss every chained call. The tx supports the four DSL paths the route
 * uses (select/delete/update) plus tx.execute(...) for the raw INSERT SQL.
 *
 * `projectExists` controls whether the initial project SELECT returns a row;
 * setting it to false drives the 404 path.
 */
function makeDrizzle({ projectExists = true } = {}) {
  const log = {
    transactionCalls: 0,
    selectCalls: 0,
    deletes: [],
    executes: [],
    updates: []
  }

  const tx = {
    select: vi.fn(() => {
      log.selectCalls += 1
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve(projectExists ? [{ id: PROJECT_ID }] : [])
            )
          }))
        }))
      }
    }),
    delete: vi.fn((table) => ({
      where: vi.fn(() => {
        log.deletes.push(table)
        return Promise.resolve()
      })
    })),
    execute: vi.fn((sqlChunk) => {
      log.executes.push(sqlChunk)
      return Promise.resolve()
    }),
    update: vi.fn((table) => ({
      set: vi.fn(() => ({
        where: vi.fn(() => {
          log.updates.push(table)
          return Promise.resolve()
        })
      }))
    }))
  }

  const drizzle = {
    transaction: vi.fn(async (cb) => {
      log.transactionCalls += 1
      return cb(tx)
    })
  }

  return { drizzle, tx, log }
}

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

describe('validateBaseline handler happy paths', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: MOCK_BUCKET,
      key: MOCK_KEY
    })
    vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
    vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(readBaselineGeoPackage).mockReturnValue(STUB_LAYERS)
    vi.mocked(validateBaselineLayers).mockResolvedValue({
      valid: true,
      errors: []
    })
    vi.mocked(extractBaseline).mockReturnValue(STUB_EXTRACTED)
  })

  function makeRequest(payload = null) {
    return {
      params: { uploadId: UPLOAD_ID },
      payload,
      drizzle: drizzleHarness.drizzle
    }
  }

  it('waits for the upload to be ready using the uploadId', async () => {
    await validateBaseline.handler(makeRequest(), h)

    expect(waitForUploadReady).toHaveBeenCalledWith(UPLOAD_ID)
  })

  it('downloads the file using the resolved bucket and key', async () => {
    await validateBaseline.handler(makeRequest(), h)

    expect(downloadFile).toHaveBeenCalledWith(MOCK_BUCKET, MOCK_KEY)
  })

  it('runs the gpkg gate against the downloaded buffer', async () => {
    await validateBaseline.handler(makeRequest(), h)

    expect(validateGpkg).toHaveBeenCalledWith(MOCK_BUFFER)
  })

  it('runs full baseline validation when the gate passes', async () => {
    await validateBaseline.handler(makeRequest(), h)

    expect(readBaselineGeoPackage).toHaveBeenCalled()
    expect(validateBaselineLayers).toHaveBeenCalledWith(STUB_LAYERS, undefined)
  })

  it('returns the baseline validation result when valid', async () => {
    const result = { valid: true, errors: [] }
    vi.mocked(validateBaselineLayers).mockResolvedValue(result)

    await validateBaseline.handler(makeRequest(), h)

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

    await validateBaseline.handler(makeRequest(), h)

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

    await validateBaseline.handler(makeRequest(), h)

    expect(h.response).toHaveBeenCalledWith(gateResult)
    expect(validateBaselineLayers).not.toHaveBeenCalled()
  })
})

describe('validateBaseline handler persistence', () => {
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
    vi.mocked(validateBaselineLayers).mockResolvedValue({
      valid: true,
      errors: []
    })
    vi.mocked(extractBaseline).mockReturnValue(STUB_EXTRACTED)
  })

  it('does not call extractBaseline or open a transaction when no projectId is supplied', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: null,
      drizzle
    }

    await validateBaseline.handler(request, h)

    expect(extractBaseline).not.toHaveBeenCalled()
    expect(log.transactionCalls).toBe(0)
  })

  it('opens a transaction when projectId is supplied and validation passes', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    await validateBaseline.handler(request, h)

    expect(extractBaseline).toHaveBeenCalledWith(STUB_LAYERS, {
      uploadId: UPLOAD_ID
    })
    expect(log.transactionCalls).toBe(1)
  })

  it('checks the project exists at the start of the transaction', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    await validateBaseline.handler(request, h)

    expect(log.selectCalls).toBe(1)
  })

  it('deletes prior baseline rows from all four feature tables before inserting', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    await validateBaseline.handler(request, h)

    expect(log.deletes).toHaveLength(4)
  })

  it('inserts geometry rows for each non-empty layer', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    await validateBaseline.handler(request, h)

    // Stub data has 1 red line + 1 habitat + 1 hedgerow + 1 watercourse = 4 inserts
    expect(log.executes).toHaveLength(4)
  })

  it('updates the project JSONB document at the end of the transaction', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    await validateBaseline.handler(request, h)

    expect(log.updates).toHaveLength(1)
  })

  it('does not persist when projectId is supplied but validation fails', async () => {
    vi.mocked(validateBaselineLayers).mockResolvedValue({
      valid: false,
      errors: [{ code: 'REDLINE_INVALID_GEOMETRY', message: 'bad' }]
    })

    const { drizzle, log } = makeDrizzle()
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    await validateBaseline.handler(request, h)

    expect(extractBaseline).not.toHaveBeenCalled()
    expect(log.transactionCalls).toBe(0)
  })

  it('throws a 404 Boom error when the projectId does not match an existing project', async () => {
    const { drizzle } = makeDrizzle({ projectExists: false })
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    const err = await validateBaseline.handler(request, h).catch((e) => e)

    expect(err.isBoom).toBe(true)
    expect(err.output.statusCode).toBe(HTTP_404)
  })

  it('does not insert any geometry rows when the project is missing', async () => {
    const { drizzle, log } = makeDrizzle({ projectExists: false })
    const request = {
      params: { uploadId: UPLOAD_ID },
      payload: { projectId: PROJECT_ID },
      drizzle
    }

    await validateBaseline.handler(request, h).catch(() => {})

    expect(log.executes).toHaveLength(0)
    expect(log.updates).toHaveLength(0)
  })
})

describe('validateBaseline handler upload error handling', () => {
  const request = { params: { uploadId: UPLOAD_ID }, payload: null }
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
  const request = { params: { uploadId: UPLOAD_ID }, payload: null }
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
  const request = { params: { uploadId: UPLOAD_ID }, payload: null }
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
