import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUploadStatus } from '../services/cdp-uploader/cdp-uploader.js'
import { downloadObject } from '../services/s3/s3.js'
import { validateBaselineFile } from '../validation/baseline/index.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

vi.mock('../services/cdp-uploader/cdp-uploader.js', () => ({
  getUploadStatus: vi.fn()
}))

vi.mock('../services/s3/s3.js', () => ({
  downloadObject: vi.fn()
}))

vi.mock('../validation/baseline/index.js', () => ({
  validateBaselineFile: vi.fn()
}))

const { validateBaseline } = await import('./baseline.js')

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const S3_BUCKET = 'baseline-files'
const S3_KEY = 'baseline/abc.gpkg'

function makeH() {
  const h = {
    response: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis()
  }
  return h
}

describe('POST /baseline/validate/{uploadId}', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 409 when the upload is not ready yet', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'pending'
    })
    const h = makeH()
    await validateBaseline.handler({ params: { uploadId: UPLOAD_ID } }, h)
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({ valid: false })
    )
    expect(h.code).toHaveBeenCalledWith(HTTP_STATUS.CONFLICT)
  })

  it('returns 500 when the S3 location is missing', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready',
      s3Bucket: null,
      s3Key: null
    })
    const h = makeH()
    await validateBaseline.handler({ params: { uploadId: UPLOAD_ID } }, h)
    expect(h.code).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR)
  })

  it('downloads the file and returns the validation result', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready',
      s3Bucket: S3_BUCKET,
      s3Key: S3_KEY
    })
    vi.mocked(downloadObject).mockResolvedValue()
    vi.mocked(validateBaselineFile).mockResolvedValue({
      valid: true,
      errors: []
    })

    const h = makeH()
    await validateBaseline.handler({ params: { uploadId: UPLOAD_ID } }, h)

    expect(downloadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: S3_BUCKET,
        key: S3_KEY
      })
    )
    expect(validateBaselineFile).toHaveBeenCalled()
    expect(h.response).toHaveBeenCalledWith({ valid: true, errors: [] })
  })

  it('returns 500 when downloading or validating throws', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready',
      s3Bucket: S3_BUCKET,
      s3Key: S3_KEY
    })
    vi.mocked(downloadObject).mockRejectedValue(new Error('S3 down'))

    const h = makeH()
    await validateBaseline.handler({ params: { uploadId: UPLOAD_ID } }, h)
    expect(h.code).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR)
  })
})
