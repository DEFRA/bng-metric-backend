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

vi.mock('../validation/baseline/index.js', () => ({
  validateBaselineFile: vi.fn()
}))

vi.mock('node:fs/promises', () => {
  const fs = {
    mkdtemp: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined)
  }
  return { default: fs, ...fs }
})

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
const { validateBaselineFile } = await import('../validation/baseline/index.js')
const fs = (await import('node:fs/promises')).default
const { validateBaseline } = await import('./baseline.js')

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const MOCK_BUCKET = 'baseline-files'
const MOCK_KEY = 'baseline/file.gpkg'
const MOCK_BUFFER = Buffer.from('mock-gpkg-data')
const THROWS_502 = 'throws a 502 Bad Gateway'

const HTTP_422 = 422
const HTTP_502 = 502
const HTTP_504 = 504
const HTTP_413 = 413

function makeH() {
  return {
    response: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis()
  }
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

const MOCK_TMP_DIR = '/tmp/baseline-test'

describe('validateBaseline handler happy paths', () => {
  const request = { params: { uploadId: UPLOAD_ID } }
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
    vi.mocked(validateBaselineFile).mockResolvedValue({
      valid: true,
      errors: []
    })
    vi.mocked(fs.mkdtemp).mockResolvedValue(MOCK_TMP_DIR)
  })

  it('waits for the upload to be ready using the uploadId', async () => {
    await validateBaseline.handler(request, h)

    expect(waitForUploadReady).toHaveBeenCalledWith(UPLOAD_ID)
  })

  it('downloads the file using the resolved bucket and key', async () => {
    await validateBaseline.handler(request, h)

    expect(downloadFile).toHaveBeenCalledWith(MOCK_BUCKET, MOCK_KEY)
  })

  it('runs the gpkg gate against the staged file', async () => {
    await validateBaseline.handler(request, h)

    expect(validateGpkg).toHaveBeenCalledWith(
      expect.stringMatching(/baseline\.gpkg$/)
    )
  })

  it('runs full baseline validation when the gate passes', async () => {
    await validateBaseline.handler(request, h)

    expect(validateBaselineFile).toHaveBeenCalled()
  })

  it('returns the baseline validation result when valid', async () => {
    const result = { valid: true, errors: [] }
    vi.mocked(validateBaselineFile).mockResolvedValue(result)

    await validateBaseline.handler(request, h)

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
    vi.mocked(validateBaselineFile).mockResolvedValue(result)

    await validateBaseline.handler(request, h)

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

    await validateBaseline.handler(request, h)

    expect(h.response).toHaveBeenCalledWith(gateResult)
    expect(validateBaselineFile).not.toHaveBeenCalled()
  })
})

describe('validateBaseline handler upload error handling', () => {
  const request = { params: { uploadId: UPLOAD_ID } }
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
    vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(validateBaselineFile).mockResolvedValue({
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
  const request = { params: { uploadId: UPLOAD_ID } }
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: MOCK_BUCKET,
      key: MOCK_KEY
    })
    vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
    vi.mocked(validateBaselineFile).mockResolvedValue({
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
  const request = { params: { uploadId: UPLOAD_ID } }
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
    vi.mocked(fs.mkdtemp).mockResolvedValue(MOCK_TMP_DIR)
  })

  it('returns 500 when validateBaselineFile throws', async () => {
    vi.mocked(validateBaselineFile).mockRejectedValue(new Error('boom'))

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

describe('validateBaseline handler tmp file lifecycle', () => {
  const request = { params: { uploadId: UPLOAD_ID } }
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
    vi.mocked(validateBaselineFile).mockResolvedValue({
      valid: true,
      errors: []
    })
    vi.mocked(fs.mkdtemp).mockResolvedValue(MOCK_TMP_DIR)
  })

  it('writes the downloaded buffer to a tmp file before running the gate', async () => {
    await validateBaseline.handler(request, h)

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/baseline\.gpkg$/),
      MOCK_BUFFER
    )
    const writeOrder = vi.mocked(fs.writeFile).mock.invocationCallOrder[0]
    const gateOrder = vi.mocked(validateGpkg).mock.invocationCallOrder[0]
    expect(writeOrder).toBeLessThan(gateOrder)
  })

  it('removes the tmp dir after the gate fails', async () => {
    vi.mocked(validateGpkg).mockReturnValue({ valid: false, errors: [] })

    await validateBaseline.handler(request, h)

    expect(fs.rm).toHaveBeenCalledWith(MOCK_TMP_DIR, {
      recursive: true,
      force: true
    })
  })

  it('removes the tmp dir when full validation throws', async () => {
    vi.mocked(validateBaselineFile).mockRejectedValue(new Error('boom'))

    await validateBaseline.handler(request, h)

    expect(fs.rm).toHaveBeenCalledWith(MOCK_TMP_DIR, {
      recursive: true,
      force: true
    })
  })
})
