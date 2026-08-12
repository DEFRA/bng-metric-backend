import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import {
  UPLOAD_ID,
  PROJECT_ID,
  SUB,
  MOCK_BUCKET,
  MOCK_KEY,
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
} from './validate-geopackage-route.test-fixtures.js'

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

vi.mock('../validation/geopackage/geopackage.js', () => ({
  validateGpkg: vi.fn(),
  readGeoPackage: vi.fn()
}))

vi.mock('../validation/geopackage/baseline/extract-habitat-data.js', () => ({
  extractHabitatData: vi.fn()
}))

vi.mock('../validation/geopackage/index.js', () => ({
  validateGeoPackageLayers: vi.fn()
}))

vi.mock('../services/upload/calculate-habitat-sizes.js', () => ({
  calculateHabitatSizes: vi.fn()
}))

vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFile: vi.fn() }
})

const { waitForUploadReady, UploadFailedError, UploadTimeoutError } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const { downloadFile, S3FileTooLargeError, S3TimeoutError, S3ConnectionError } =
  await import('../services/s3/download-file.js')
const { validateGpkg, readGeoPackage } =
  await import('../validation/geopackage/geopackage.js')
const { extractHabitatData } =
  await import('../validation/geopackage/baseline/extract-habitat-data.js')
const { validateGeoPackageLayers } =
  await import('../validation/geopackage/index.js')
const { calculateHabitatSizes } =
  await import('../services/upload/calculate-habitat-sizes.js')
const { ERROR_CODES } = await import('../validation/geopackage/errors.js')
const { validateBaseline } = await import('./baseline.js')

function setupHappyPathMocks() {
  vi.mocked(waitForUploadReady).mockResolvedValue({
    bucket: MOCK_BUCKET,
    key: MOCK_KEY
  })
  vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
  vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
  vi.mocked(readGeoPackage).mockReturnValue(STUB_LAYERS)
  vi.mocked(validateGeoPackageLayers).mockResolvedValue({
    valid: true,
    errors: []
  })
  vi.mocked(extractHabitatData).mockReturnValue(STUB_EXTRACTED)
  vi.mocked(calculateHabitatSizes).mockResolvedValue({
    areaHabitats: { individualSquareMetres: [], totalSquareMetres: 0 },
    hedgerows: { individualMetres: [], totalMetres: 0 },
    watercourses: { individualMetres: [], totalMetres: 0 }
  })
}

function makeBaselineRequest({ drizzle, payload = null, sub = SUB } = {}) {
  return {
    params: { uploadId: UPLOAD_ID },
    payload,
    drizzle,
    auth: { credentials: { sub } }
  }
}

const HAPPY_PATH_EXECUTE_COUNT = 5

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
    expect(extractHabitatData).toHaveBeenCalledWith(
      STUB_LAYERS,
      expect.objectContaining({ uploadId: UPLOAD_ID })
    )
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

  it('deletes prior baseline rows from all five feature tables before inserting', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)
    expect(log.deletes).toHaveLength(5)
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

  it('writes status and size fields into the persisted JSONB baseline document', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makeBaselineRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })
    await validateBaseline.handler(request, h)

    const docJson = log.updates[0].payload.project.queryChunks.find(
      (chunk) => typeof chunk === 'string' && chunk.includes('"habitats"')
    )
    const document = JSON.parse(docJson)
    expect(document.habitats[0]).toEqual(
      expect.objectContaining({
        status: 'Complete',
        sizeSquareMetres: 10
      })
    )
    expect(document.hedgerows[0]).toEqual(
      expect.objectContaining({
        status: 'Complete',
        sizeMetres: 20
      })
    )
    expect(document.watercourses[0]).toEqual(
      expect.objectContaining({
        status: 'Complete',
        sizeMetres: 30,
        watercourseEncroachment: 'No Encroachment'
      })
    )
    expect(document.habitatSizes).toEqual(
      expect.objectContaining({
        areaHabitats: { totalSquareMetres: 10 }
      })
    )
  })

  it('passes habitatSizes into extractHabitatData as meta', async () => {
    const sizes = {
      areaHabitats: { individualSquareMetres: [], totalSquareMetres: 0 },
      hedgerows: { individualMetres: [], totalMetres: 0 },
      watercourses: { individualMetres: [], totalMetres: 0 }
    }
    vi.mocked(calculateHabitatSizes).mockResolvedValue(sizes)

    const { drizzle } = makeDrizzle()
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle, payload: { projectId: PROJECT_ID } }),
      makeH()
    )

    expect(extractHabitatData).toHaveBeenCalledWith(
      STUB_LAYERS,
      expect.objectContaining({ habitatSizes: sizes })
    )
  })
})

describe('validateBaseline handler persistence — guard rails', () => {
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
    expect(log.executes).toHaveLength(1)
    expect(log.updates).toHaveLength(0)
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
    expect(log.executes).toHaveLength(1)
    expect(log.updates).toHaveLength(0)
  })

  it('does not write the project document when an insert throws', async () => {
    const { drizzle, tx, log } = makeDrizzle()
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
    vi.mocked(readGeoPackage).mockReturnValue(STUB_LAYERS)
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
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
    vi.mocked(readGeoPackage).mockReturnValue(STUB_LAYERS)
  })

  it('returns 500 when validateGeoPackageLayers throws', async () => {
    vi.mocked(validateGeoPackageLayers).mockRejectedValue(new Error('boom'))

    await validateBaseline.handler(request, h)

    expect(h.code).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Unable to validate baseline file'
          })
        ]
      })
    )
  })

  it('returns 500 SIZING_FAILED when calculateHabitatSizes throws', async () => {
    vi.mocked(validateGeoPackageLayers).mockResolvedValue({
      valid: true,
      errors: []
    })
    vi.mocked(calculateHabitatSizes).mockRejectedValue(
      new Error('DB connection lost')
    )

    const { drizzle } = makeDrizzle()
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle, payload: { projectId: PROJECT_ID } }),
      h
    )

    expect(h.code).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.SIZING_FAILED,
            message: 'Unable to calculate habitat sizes'
          })
        ]
      })
    )
  })
})

describe('validateBaseline handler — document schema validation', () => {
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    setupHappyPathMocks()
  })

  it('returns INVALID_FILE_METADATA when filename exceeds the allowed length', async () => {
    vi.mocked(extractHabitatData).mockReturnValue({
      document: { ...STUB_EXTRACTED.document, filename: 'x'.repeat(256) },
      geometries: STUB_EXTRACTED.geometries
    })
    const { drizzle } = makeDrizzle()
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle, payload: { projectId: PROJECT_ID } }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        errors: [
          expect.objectContaining({ code: ERROR_CODES.INVALID_FILE_METADATA })
        ]
      })
    )
  })

  it('does not open a transaction when document schema validation fails', async () => {
    vi.mocked(extractHabitatData).mockReturnValue({
      document: { ...STUB_EXTRACTED.document, filename: 'x'.repeat(256) },
      geometries: STUB_EXTRACTED.geometries
    })
    const { drizzle, log } = makeDrizzle()
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle, payload: { projectId: PROJECT_ID } }),
      h
    )
    expect(log.transactionCalls).toBe(0)
  })
})
