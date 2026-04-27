import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/cdp-uploader/cdp-uploader.js', () => ({
  waitForUploadReady: vi.fn(),
  UploadFailedError: class UploadFailedError extends Error {
    constructor(message) {
      super(message)
      this.name = 'UploadFailedError'
    }
  },
  UploadTimeoutError: class UploadTimeoutError extends Error {
    constructor(message) {
      super(message)
      this.name = 'UploadTimeoutError'
    }
  }
}))

vi.mock('../services/gpkg/validate-gpkg.js', () => ({
  validateGpkg: vi.fn()
}))

// Preserve real error classes so instanceof checks in the handler work correctly
vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFile: vi.fn() }
})

const { waitForUploadReady, UploadFailedError, UploadTimeoutError } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const { downloadFile, S3TimeoutError, S3ConnectionError } =
  await import('../services/s3/download-file.js')
const { validateGpkg } = await import('../services/gpkg/validate-gpkg.js')
const { validateBaseline } = await import('./baseline.js')

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const MOCK_BUCKET = 'baseline-files'
const MOCK_KEY = 'baseline/file.gpkg'
const MOCK_BUFFER = Buffer.from('mock-gpkg-data')

const mockH = { response: vi.fn().mockReturnThis() }

describe('validateBaseline route', () => {
  describe('route configuration', () => {
    it('is a POST route', () => {
      expect(validateBaseline.method).toBe('POST')
    })

    it('has the correct path', () => {
      expect(validateBaseline.path).toBe('/baseline/validate/{uploadId}')
    })
  })

  describe('Joi param validation', () => {
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

  describe('handler', () => {
    const request = { params: { uploadId: UPLOAD_ID } }

    beforeEach(() => {
      vi.mocked(waitForUploadReady).mockResolvedValue({
        bucket: MOCK_BUCKET,
        key: MOCK_KEY
      })
      vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
    })

    it('waits for the upload to be ready using the uploadId', async () => {
      vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })

      await validateBaseline.handler(request, mockH)

      expect(waitForUploadReady).toHaveBeenCalledWith(UPLOAD_ID)
    })

    it('downloads the file using the resolved bucket and key', async () => {
      vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })

      await validateBaseline.handler(request, mockH)

      expect(downloadFile).toHaveBeenCalledWith(MOCK_BUCKET, MOCK_KEY)
    })

    it('validates the downloaded buffer', async () => {
      vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })

      await validateBaseline.handler(request, mockH)

      expect(validateGpkg).toHaveBeenCalledWith(MOCK_BUFFER)
    })

    it('returns the validation result when valid', async () => {
      vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })

      await validateBaseline.handler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith({ valid: true, errors: [] })
    })

    it('returns the validation result when invalid', async () => {
      const validationResult = {
        valid: false,
        errors: [
          'Missing required feature layer in GeoPackage: Red Line Boundary'
        ]
      }
      vi.mocked(validateGpkg).mockReturnValue(validationResult)

      await validateBaseline.handler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith(validationResult)
    })

    describe('when waitForUploadReady throws an UploadTimeoutError', () => {
      it('throws a 504 Gateway Timeout', async () => {
        vi.mocked(waitForUploadReady).mockRejectedValue(
          new UploadTimeoutError('timed out')
        )

        const err = await validateBaseline
          .handler(request, mockH)
          .catch((e) => e)

        expect(err.isBoom).toBe(true)
        expect(err.output.statusCode).toBe(504)
        expect(err.message).toBe('Upload did not complete in time')
      })
    })

    describe('when waitForUploadReady throws an UploadFailedError', () => {
      it('throws a 502 Bad Gateway', async () => {
        vi.mocked(waitForUploadReady).mockRejectedValue(
          new UploadFailedError('rejected')
        )

        const err = await validateBaseline
          .handler(request, mockH)
          .catch((e) => e)

        expect(err.isBoom).toBe(true)
        expect(err.output.statusCode).toBe(502)
        expect(err.message).toBe('Upload failed or was rejected')
      })
    })

    describe('when waitForUploadReady throws an unexpected error', () => {
      it('throws a 502 Bad Gateway', async () => {
        vi.mocked(waitForUploadReady).mockRejectedValue(new Error('unexpected'))

        const err = await validateBaseline
          .handler(request, mockH)
          .catch((e) => e)

        expect(err.isBoom).toBe(true)
        expect(err.output.statusCode).toBe(502)
      })

      it('does not attempt to download the file', async () => {
        vi.mocked(waitForUploadReady).mockRejectedValue(new Error())

        await validateBaseline.handler(request, mockH).catch(() => {})

        expect(downloadFile).not.toHaveBeenCalled()
      })
    })

    describe('when downloadFile throws an S3TimeoutError', () => {
      it('throws a 504 Gateway Timeout', async () => {
        vi.mocked(downloadFile).mockRejectedValue(
          new S3TimeoutError('timed out')
        )

        const err = await validateBaseline
          .handler(request, mockH)
          .catch((e) => e)

        expect(err.isBoom).toBe(true)
        expect(err.output.statusCode).toBe(504)
        expect(err.message).toBe('Timed out downloading file from storage')
      })
    })

    describe('when downloadFile throws an S3ConnectionError', () => {
      it('throws a 502 Bad Gateway', async () => {
        vi.mocked(downloadFile).mockRejectedValue(
          new S3ConnectionError('connection refused')
        )

        const err = await validateBaseline
          .handler(request, mockH)
          .catch((e) => e)

        expect(err.isBoom).toBe(true)
        expect(err.output.statusCode).toBe(502)
        expect(err.message).toBe('Unable to download file from storage')
      })
    })

    describe('when downloadFile throws an unexpected error', () => {
      it('throws a 502 Bad Gateway', async () => {
        vi.mocked(downloadFile).mockRejectedValue(new Error('unexpected'))

        const err = await validateBaseline
          .handler(request, mockH)
          .catch((e) => e)

        expect(err.isBoom).toBe(true)
        expect(err.output.statusCode).toBe(502)
      })
    })
  })
})
