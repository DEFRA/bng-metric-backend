import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Wreck from '@hapi/wreck'

import { config } from '../../config.js'

vi.mock('@hapi/wreck', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
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
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT
  })

  it('should return uploadId and extract path from full uploadUrl', async () => {
    vi.mocked(Wreck.post).mockResolvedValue({
      payload: {
        uploadId: 'abc-123',
        uploadUrl: 'http://localhost:7337/upload/abc-123'
      }
    })

    const result = await initiateUpload({
      redirect: '/projects/1/upload-received',
      s3Bucket: S3_BUCKET,
      s3Path: 'baseline/'
    })

    expect(result).toEqual({
      uploadId: 'abc-123',
      uploadUrl: '/upload/abc-123'
    })

    expect(Wreck.post).toHaveBeenCalledWith(
      'http://localhost:7337/initiate',
      expect.objectContaining({
        payload: JSON.stringify({
          redirect: '/projects/1/upload-received',
          s3Bucket: S3_BUCKET,
          s3Path: 'baseline/',
          metadata: undefined
        }),
        headers: { 'Content-Type': 'application/json' },
        json: true
      })
    )
  })

  it('should return uploadUrl as-is when it is a relative path', async () => {
    vi.mocked(Wreck.post).mockResolvedValue({
      payload: {
        uploadId: 'abc-123',
        uploadUrl: '/upload/abc-123'
      }
    })

    const result = await initiateUpload({
      redirect: '/projects/1/upload-received',
      s3Bucket: S3_BUCKET
    })

    expect(result.uploadUrl).toBe('/upload/abc-123')
  })

  it('should return error when Wreck.post throws', async () => {
    vi.mocked(Wreck.post).mockRejectedValue(new Error('Connection refused'))

    const result = await initiateUpload({
      redirect: '/projects/1/upload-received',
      s3Bucket: S3_BUCKET
    })

    expect(result).toEqual({ error: 'Unable to initiate upload' })
  })
})

describe('getUploadStatus response fields', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT
  })

  it('should return uploadStatus and numberOfRejectedFiles from the response', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
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

    const result = await getUploadStatus('abc-123')

    expect(result).toEqual({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 0,
      errorMessage: null
    })
    expect(Wreck.get).toHaveBeenCalledWith(
      'http://localhost:7337/status/abc-123',
      { json: true }
    )
  })

  it('should return errorMessage from a rejected file', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
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

    const result = await getUploadStatus('abc-123')

    expect(result).toEqual({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 1,
      errorMessage: 'The selected file contains a virus'
    })
  })

  it('should return null errorMessage when file is rejected but has no errorMessage', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 1,
        form: { file: { fileStatus: 'rejected' } }
      }
    })

    const result = await getUploadStatus('abc-123')

    expect(result.errorMessage).toBeNull()
  })

  it('should return null errorMessage when file is not rejected', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 0,
        form: { file: { fileStatus: 'complete' } }
      }
    })

    const result = await getUploadStatus('abc-123')

    expect(result.errorMessage).toBeNull()
  })
})

describe('getUploadStatus edge cases', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT
  })

  it('should return unknown when uploadStatus is missing', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: {}
    })

    const result = await getUploadStatus('abc-123')

    expect(result).toEqual({
      uploadStatus: 'unknown',
      numberOfRejectedFiles: 0,
      errorMessage: null
    })
  })

  it('should return error status when Wreck.get throws', async () => {
    vi.mocked(Wreck.get).mockRejectedValue(new Error('Connection refused'))

    const result = await getUploadStatus('abc-123')

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

  it('should return bucket and key from form.file', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        form: {
          file: { s3Bucket: S3_BUCKET, s3Key: S3_KEY }
        }
      }
    })

    const result = await getUploadedFileS3Location('abc-123')

    expect(result).toEqual({
      bucket: S3_BUCKET,
      key: S3_KEY
    })
  })

  it('should throw when form.file is absent', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: { uploadStatus: 'ready' }
    })

    await expect(getUploadedFileS3Location('abc-123')).rejects.toThrow(
      'No file found for uploadId: abc-123'
    )
  })

  it('should throw when s3Key is missing', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: { form: { file: { s3Bucket: S3_BUCKET } } }
    })

    await expect(getUploadedFileS3Location('abc-123')).rejects.toThrow(
      'S3 location missing'
    )
  })

  it('should throw when s3Bucket is missing', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: { form: { file: { s3Key: S3_KEY } } }
    })

    await expect(getUploadedFileS3Location('abc-123')).rejects.toThrow(
      'S3 location missing'
    )
  })
})

describe('waitForUploadReady', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT
  })

  const readyPayload = {
    uploadStatus: 'ready',
    numberOfRejectedFiles: 0,
    form: {
      file: { s3Bucket: S3_BUCKET, s3Key: S3_KEY }
    }
  }

  const pendingPayload = {
    uploadStatus: 'pending',
    numberOfRejectedFiles: 0
  }

  it('should return S3 location immediately when status is already ready', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({ payload: readyPayload })

    const result = await waitForUploadReady('abc-123', { pollIntervalMs: 0 })

    expect(result).toEqual({
      bucket: S3_BUCKET,
      key: S3_KEY
    })
  })

  it('should poll until the status becomes ready', async () => {
    vi.mocked(Wreck.get)
      .mockResolvedValueOnce({ payload: pendingPayload })
      .mockResolvedValueOnce({ payload: pendingPayload })
      .mockResolvedValue({ payload: readyPayload })

    const result = await waitForUploadReady('abc-123', { pollIntervalMs: 0 })

    expect(result).toEqual({
      bucket: S3_BUCKET,
      key: S3_KEY
    })
    // 2 pending status polls + 1 ready status poll + 1 S3 location fetch
    expect(Wreck.get).toHaveBeenCalledTimes(4)
  })

  it('should throw UploadFailedError when uploadStatus is "rejected"', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: { uploadStatus: 'rejected', numberOfRejectedFiles: 1 }
    })

    await expect(
      waitForUploadReady('abc-123', { pollIntervalMs: 0 })
    ).rejects.toThrow(UploadFailedError)
  })

  it('should retry rather than fail immediately when CDP Uploader returns a connection error', async () => {
    vi.mocked(Wreck.get)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ payload: readyPayload })

    const result = await waitForUploadReady('abc-123', { pollIntervalMs: 0 })

    expect(result).toEqual({
      bucket: S3_BUCKET,
      key: S3_KEY
    })
  })

  it('should throw UploadTimeoutError when the deadline is exceeded', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({ payload: pendingPayload })

    await expect(
      waitForUploadReady('abc-123', { timeoutMs: 0, pollIntervalMs: 0 })
    ).rejects.toThrow(UploadTimeoutError)
  })

  it('should throw UploadTimeoutError with a descriptive message', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({ payload: pendingPayload })

    await expect(
      waitForUploadReady('abc-123', { timeoutMs: 0, pollIntervalMs: 0 })
    ).rejects.toThrow(/did not reach 'ready' status/)
  })
})
