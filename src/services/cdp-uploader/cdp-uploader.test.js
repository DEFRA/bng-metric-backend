import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { config } from '../../config.js'
import { uploaderGet, uploaderPost } from './uploader-http.js'

vi.mock('./uploader-http.js', () => ({
  uploaderGet: vi.fn(),
  uploaderPost: vi.fn()
}))

const {
  getCdpUploaderUrl,
  initiateUpload,
  getUploadStatus,
  getUploadedFileS3Location,
  waitForUploadReady,
  UploadFailedError,
  UploadTimeoutError
} = await import('./cdp-uploader.js')

const S3_BUCKET = 'baseline-files'
const S3_KEY = 'baseline/file.gpkg'
const UPLOAD_ID = 'abc-123'
const REDIRECT = '/projects/1/upload-received'
const FILENAME = 'survey.gpkg'
const UPLOADED_FILE_SIZE = 204800
const MAX_FILE_SIZE_BYTES = 104857600
const REQUEST_TIMEOUT_MS = 5000
const READY_WAIT_MS = 1000
const LATE_READY_MS = 2000
const SHORT_WAIT_MS = 50
const LONG_POLL_INTERVAL_MS = 5000

describe('getCdpUploaderUrl', () => {
  const originalEnv = process.env.ENVIRONMENT

  afterEach(() => {
    process.env.ENVIRONMENT = originalEnv
  })

  it('should return explicit URL from config when set', () => {
    vi.spyOn(config, 'get').mockReturnValue(
      'https://custom-uploader.example.com'
    )

    expect(getCdpUploaderUrl()).toBe('https://custom-uploader.example.com')
  })

  it('should derive URL from ENVIRONMENT when config is not set', () => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    process.env.ENVIRONMENT = 'dev'

    expect(getCdpUploaderUrl()).toBe(
      'https://cdp-uploader.dev.cdp-int.defra.cloud'
    )
  })

  it('should return localhost fallback when no config or environment', () => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT

    expect(getCdpUploaderUrl()).toBe('http://localhost:7337')
  })
})

describe('initiateUpload', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'upload.maxFileSizeBytes') {
        return MAX_FILE_SIZE_BYTES
      }
      return key === 'cdpUploader.requestTimeoutMs' ? REQUEST_TIMEOUT_MS : null
    })
    delete process.env.ENVIRONMENT
  })

  it('should return uploadId and extract path from full uploadUrl', async () => {
    vi.mocked(uploaderPost).mockResolvedValue({
      payload: {
        uploadId: UPLOAD_ID,
        uploadUrl: 'http://localhost:7337/upload/abc-123'
      }
    })

    const result = await initiateUpload({
      redirect: REDIRECT,
      s3Bucket: S3_BUCKET,
      s3Path: 'baseline/'
    })

    expect(result).toEqual({
      uploadId: UPLOAD_ID,
      uploadUrl: '/upload/abc-123'
    })

    expect(uploaderPost).toHaveBeenCalledWith(
      'http://localhost:7337/initiate',
      expect.objectContaining({
        // Trailing slash on s3Path is stripped to avoid producing s3Keys
        // with a double slash after cdp-uploader concatenates segments.
        payload: JSON.stringify({
          redirect: REDIRECT,
          s3Bucket: S3_BUCKET,
          s3Path: 'baseline',
          maxFileSize: MAX_FILE_SIZE_BYTES
        }),
        headers: { 'Content-Type': 'application/json' }
      }),
      REQUEST_TIMEOUT_MS
    )
  })

  it('should return uploadUrl as-is when it is a relative path', async () => {
    vi.mocked(uploaderPost).mockResolvedValue({
      payload: {
        uploadId: UPLOAD_ID,
        uploadUrl: '/upload/abc-123'
      }
    })

    const result = await initiateUpload({
      redirect: REDIRECT,
      s3Bucket: S3_BUCKET
    })

    expect(result.uploadUrl).toBe('/upload/abc-123')
  })

  it('should return error when the uploader call throws', async () => {
    vi.mocked(uploaderPost).mockRejectedValue(new Error('Connection refused'))

    const result = await initiateUpload({
      redirect: REDIRECT,
      s3Bucket: S3_BUCKET
    })

    expect(result).toEqual({ error: 'Unable to initiate upload' })
  })
})

function stubLocalUploaderUrl() {
  vi.spyOn(config, 'get').mockImplementation((key) =>
    key === 'cdpUploader.requestTimeoutMs' ? REQUEST_TIMEOUT_MS : null
  )
  delete process.env.ENVIRONMENT
}

describe('getUploadStatus — successful responses', () => {
  beforeEach(stubLocalUploaderUrl)

  it('should return uploadStatus and numberOfRejectedFiles from the response', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 0,
        form: {
          file: {
            fileStatus: 'complete',
            s3Bucket: S3_BUCKET,
            s3Key: S3_KEY
          }
        }
      }
    })

    const result = await getUploadStatus(UPLOAD_ID)

    expect(result).toEqual({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 0,
      errorMessage: null
    })
    expect(uploaderGet).toHaveBeenCalledWith(
      'http://localhost:7337/status/abc-123',
      REQUEST_TIMEOUT_MS
    )
  })

  it('should return errorMessage from a rejected file', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 1,
        form: {
          file: {
            fileStatus: 'rejected',
            errorMessage: 'The selected file contains a virus'
          }
        }
      }
    })

    const result = await getUploadStatus(UPLOAD_ID)

    expect(result).toEqual({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 1,
      errorMessage: 'The selected file contains a virus'
    })
  })
})

describe('getUploadStatus — fallbacks and failures', () => {
  beforeEach(stubLocalUploaderUrl)

  it('should return null errorMessage when file is rejected but has no errorMessage', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 1,
        form: { file: { fileStatus: 'rejected' } }
      }
    })

    const result = await getUploadStatus(UPLOAD_ID)

    expect(result.errorMessage).toBeNull()
  })

  it('should return null errorMessage when file is not rejected', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 0,
        form: { file: { fileStatus: 'complete' } }
      }
    })

    const result = await getUploadStatus(UPLOAD_ID)

    expect(result.errorMessage).toBeNull()
  })
})

describe('getUploadStatus edge cases', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT
  })

  it('should return unknown when uploadStatus is missing', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: {}
    })

    const result = await getUploadStatus(UPLOAD_ID)

    expect(result).toEqual({
      uploadStatus: 'unknown',
      numberOfRejectedFiles: 0,
      errorMessage: null
    })
  })

  it('should return error status when the uploader call throws', async () => {
    vi.mocked(uploaderGet).mockRejectedValue(new Error('Connection refused'))

    const result = await getUploadStatus(UPLOAD_ID)

    expect(result).toEqual({
      uploadStatus: 'error',
      error: 'Unable to check upload status'
    })
  })
})

describe('getUploadedFileS3Location', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT
  })

  it('should return bucket, key, filename and fileSize from form.file', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        form: {
          file: {
            s3Bucket: S3_BUCKET,
            s3Key: S3_KEY,
            filename: FILENAME,
            contentLength: UPLOADED_FILE_SIZE
          }
        }
      }
    })

    const result = await getUploadedFileS3Location(UPLOAD_ID)

    expect(result).toEqual({
      bucket: S3_BUCKET,
      key: S3_KEY,
      filename: FILENAME,
      fileSize: UPLOADED_FILE_SIZE
    })
  })

  it('should return null filename and fileSize when absent from form.file', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        form: {
          file: { s3Bucket: S3_BUCKET, s3Key: S3_KEY }
        }
      }
    })

    const result = await getUploadedFileS3Location(UPLOAD_ID)

    expect(result).toEqual({
      bucket: S3_BUCKET,
      key: S3_KEY,
      filename: null,
      fileSize: null
    })
  })

  it('should throw when form.file is absent', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: { uploadStatus: 'ready' }
    })

    await expect(getUploadedFileS3Location(UPLOAD_ID)).rejects.toThrow(
      'No file found for uploadId: abc-123'
    )
  })

  it('should throw when s3Key is missing', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: { form: { file: { s3Bucket: S3_BUCKET } } }
    })

    await expect(getUploadedFileS3Location(UPLOAD_ID)).rejects.toThrow(
      'S3 location missing'
    )
  })

  it('should throw when s3Bucket is missing', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: { form: { file: { s3Key: S3_KEY } } }
    })

    await expect(getUploadedFileS3Location(UPLOAD_ID)).rejects.toThrow(
      'S3 location missing'
    )
  })
})

const readyUploadPayload = {
  uploadStatus: 'ready',
  numberOfRejectedFiles: 0,
  form: {
    file: {
      s3Bucket: S3_BUCKET,
      s3Key: S3_KEY,
      filename: FILENAME,
      contentLength: UPLOADED_FILE_SIZE
    }
  }
}

const pendingUploadPayload = {
  uploadStatus: 'pending',
  numberOfRejectedFiles: 0
}

const expectedUploadedFileLocation = {
  bucket: S3_BUCKET,
  key: S3_KEY,
  filename: FILENAME,
  fileSize: UPLOADED_FILE_SIZE
}

describe('waitForUploadReady when upload becomes ready', () => {
  beforeEach(stubLocalUploaderUrl)

  it('should return S3 location immediately when status is already ready', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: readyUploadPayload })

    const result = await waitForUploadReady(UPLOAD_ID, { pollIntervalMs: 0 })

    expect(result).toEqual(expectedUploadedFileLocation)
  })

  it('should poll until the status becomes ready', async () => {
    vi.mocked(uploaderGet)
      .mockResolvedValueOnce({ payload: pendingUploadPayload })
      .mockResolvedValueOnce({ payload: pendingUploadPayload })
      .mockResolvedValue({ payload: readyUploadPayload })

    const result = await waitForUploadReady(UPLOAD_ID, { pollIntervalMs: 0 })

    expect(result).toEqual(expectedUploadedFileLocation)
    // 2 pending status polls + 1 ready status poll, which carries the location
    expect(uploaderGet).toHaveBeenCalledTimes(3)
  })

  it('should retry rather than fail immediately when CDP Uploader returns a connection error', async () => {
    vi.mocked(uploaderGet)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ payload: readyUploadPayload })

    const result = await waitForUploadReady(UPLOAD_ID, { pollIntervalMs: 0 })

    expect(result).toEqual(expectedUploadedFileLocation)
  })
})

describe('waitForUploadReady failures', () => {
  beforeEach(stubLocalUploaderUrl)

  // The real CDP Uploader reports a virus-rejected single-file upload as the
  // upload COMPLETING — top-level uploadStatus 'ready' — with
  // numberOfRejectedFiles > 0 and the reason on the per-file errorMessage. There
  // is no top-level 'rejected' status, and the infected file has no s3Key.
  const virusRejectedPayload = {
    uploadStatus: 'ready',
    numberOfRejectedFiles: 1,
    form: {
      file: {
        fileStatus: 'rejected',
        errorMessage: 'The selected file contains a virus'
      }
    }
  }

  it('should throw UploadFailedError when a file is rejected (ready + numberOfRejectedFiles > 0)', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: virusRejectedPayload })

    await expect(
      waitForUploadReady(UPLOAD_ID, { pollIntervalMs: 0 })
    ).rejects.toThrow(UploadFailedError)
  })

  it('carries the rejection reason on the UploadFailedError', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: virusRejectedPayload })

    const error = await waitForUploadReady(UPLOAD_ID, {
      pollIntervalMs: 0
    }).catch((e) => e)

    expect(error).toBeInstanceOf(UploadFailedError)
    expect(error.errorMessage).toBe('The selected file contains a virus')
  })

  it('still throws UploadFailedError on a legacy top-level "rejected" status', async () => {
    // Defensive fallback: TERMINAL_FAILURE_STATUSES still catches a top-level
    // 'rejected' status should an uploader version ever emit one.
    vi.mocked(uploaderGet).mockResolvedValue({
      payload: { uploadStatus: 'rejected', numberOfRejectedFiles: 0 }
    })

    await expect(
      waitForUploadReady(UPLOAD_ID, { pollIntervalMs: 0 })
    ).rejects.toThrow(UploadFailedError)
  })

  it('should throw UploadTimeoutError when the deadline is exceeded', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: pendingUploadPayload })

    await expect(
      waitForUploadReady(UPLOAD_ID, { timeoutMs: 0, pollIntervalMs: 0 })
    ).rejects.toThrow(UploadTimeoutError)
  })

  it('should throw UploadTimeoutError with a descriptive message', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: pendingUploadPayload })

    await expect(
      waitForUploadReady(UPLOAD_ID, { timeoutMs: 0, pollIntervalMs: 0 })
    ).rejects.toThrow(/did not reach 'ready' status/)
  })
})

describe('waitForUploadReady timeouts', () => {
  beforeEach(stubLocalUploaderUrl)

  afterEach(() => {
    vi.useRealTimers()
  })

  it('gives no call more time than is left before its deadline', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: readyUploadPayload })

    await waitForUploadReady(UPLOAD_ID, {
      timeoutMs: READY_WAIT_MS,
      pollIntervalMs: 0
    })

    for (const [, timeoutMs] of vi.mocked(uploaderGet).mock.calls) {
      expect(timeoutMs).toBeGreaterThan(0)
      expect(timeoutMs).toBeLessThanOrEqual(READY_WAIT_MS)
    }
  })

  it('gives each call the uploader timeout when more time than that is left', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: readyUploadPayload })

    await waitForUploadReady(UPLOAD_ID, { pollIntervalMs: 0 })

    for (const [, timeoutMs] of vi.mocked(uploaderGet).mock.calls) {
      expect(timeoutMs).toBe(REQUEST_TIMEOUT_MS)
    }
  })

  it('reads the S3 location from the ready answer, with no second call to time out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(uploaderGet).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + LATE_READY_MS)
      return { payload: readyUploadPayload }
    })

    const result = await waitForUploadReady(UPLOAD_ID, {
      timeoutMs: READY_WAIT_MS,
      pollIntervalMs: 0
    })

    expect(result).toEqual(expectedUploadedFileLocation)
    expect(uploaderGet).toHaveBeenCalledTimes(1)
  })

  it('does not sleep past the deadline between status checks', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: pendingUploadPayload })
    const startedAt = performance.now()

    await expect(
      waitForUploadReady(UPLOAD_ID, {
        timeoutMs: SHORT_WAIT_MS,
        pollIntervalMs: LONG_POLL_INTERVAL_MS
      })
    ).rejects.toThrow(UploadTimeoutError)
    expect(performance.now() - startedAt).toBeLessThan(LONG_POLL_INTERVAL_MS)
  })
})

describe('uploader call timeouts', () => {
  beforeEach(stubLocalUploaderUrl)

  it('getUploadedFileS3Location uses the uploader timeout by default', async () => {
    vi.mocked(uploaderGet).mockResolvedValue({ payload: readyUploadPayload })

    await getUploadedFileS3Location(UPLOAD_ID)

    expect(uploaderGet).toHaveBeenCalledWith(
      'http://localhost:7337/status/abc-123',
      REQUEST_TIMEOUT_MS
    )
  })

  it('getUploadStatus answers a timed-out call as a transient error', async () => {
    const timedOut = Object.assign(new Error('Client request timeout'), {
      output: { statusCode: 504 }
    })
    vi.mocked(uploaderGet).mockRejectedValue(timedOut)

    const result = await getUploadStatus(UPLOAD_ID)

    expect(result).toEqual({
      uploadStatus: 'error',
      error: 'Unable to check upload status'
    })
  })
})
