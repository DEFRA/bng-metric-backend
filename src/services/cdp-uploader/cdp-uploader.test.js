import Wreck from '@hapi/wreck'

import { config } from '../../config.js'

vi.mock('@hapi/wreck', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
}))

const { getCdpUploaderUrl, initiateUpload, getUploadStatus } =
  await import('./cdp-uploader.js')

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
      s3Bucket: 'baseline-files',
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
          s3Bucket: 'baseline-files',
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
      s3Bucket: 'baseline-files'
    })

    expect(result.uploadUrl).toBe('/upload/abc-123')
  })

  it('should return error when Wreck.post throws', async () => {
    vi.mocked(Wreck.post).mockRejectedValue(new Error('Connection refused'))

    const result = await initiateUpload({
      redirect: '/projects/1/upload-received',
      s3Bucket: 'baseline-files'
    })

    expect(result).toEqual({ error: 'Unable to initiate upload' })
  })
})

describe('getUploadStatus', () => {
  beforeEach(() => {
    vi.spyOn(config, 'get').mockReturnValue(null)
    delete process.env.ENVIRONMENT
  })

  it('should return uploadStatus and numberOfRejectedFiles from the response', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 0,
        files: []
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

  it('should return errorMessage from rejected file', async () => {
    vi.mocked(Wreck.get).mockResolvedValue({
      payload: {
        uploadStatus: 'ready',
        numberOfRejectedFiles: 1,
        files: [
          {
            fileStatus: 'rejected',
            hasError: true,
            errorMessage: 'The selected file contains a virus'
          }
        ]
      }
    })

    const result = await getUploadStatus('abc-123')

    expect(result).toEqual({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 1,
      errorMessage: 'The selected file contains a virus'
    })
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
