import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  initiateUpload as initiateUploadService,
  getUploadStatus
} from '../services/cdp-uploader/cdp-uploader.js'
import { metricsCounter } from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_CATEGORY
} from '../common/helpers/metric-names.js'

vi.mock('../services/cdp-uploader/cdp-uploader.js')
vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(),
  metricsByteSize: vi.fn()
}))

const { initiateUpload, uploadStatus } = await import('./upload.js')

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const S3_BUCKET = 'baseline-files'
const REDIRECT = '/projects/abc/upload-received'

describe('POST /upload/initiate', () => {
  it('should return the upload result', async () => {
    vi.mocked(initiateUploadService).mockResolvedValue({
      uploadId: UPLOAD_ID,
      uploadUrl: '/upload-and-scan/f6b667d8-998f-4f55-8a20-204c0c289147'
    })

    const request = {
      payload: {
        redirect: REDIRECT,
        s3Bucket: S3_BUCKET,
        s3Path: 'baseline/',
        metadata: { projectId: 'abc' }
      }
    }

    const result = await initiateUpload.handler(request, {})

    expect(initiateUploadService).toHaveBeenCalledWith(request.payload)
    expect(result).toEqual({
      uploadId: UPLOAD_ID,
      uploadUrl: '/upload-and-scan/f6b667d8-998f-4f55-8a20-204c0c289147'
    })
  })

  it('should throw a Boom badGateway when the upload service returns an error', async () => {
    vi.mocked(initiateUploadService).mockResolvedValue({
      error: 'Unable to initiate upload'
    })

    const request = {
      payload: {
        redirect: REDIRECT,
        s3Bucket: S3_BUCKET
      }
    }

    await expect(initiateUpload.handler(request, {})).rejects.toThrow(
      'Unable to initiate upload'
    )
  })

  it('should throw a Boom internal error for unexpected failures', async () => {
    vi.mocked(initiateUploadService).mockRejectedValue(
      new Error('Network timeout')
    )

    const request = {
      payload: {
        redirect: REDIRECT,
        s3Bucket: S3_BUCKET
      }
    }

    await expect(initiateUpload.handler(request, {})).rejects.toThrow(
      'Failed to initiate upload'
    )
  })
})

describe('GET /upload/{uploadId}/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeStatusRequest = () => ({ params: { uploadId: UPLOAD_ID } })
  const makeStatusH = () => ({ response: vi.fn().mockReturnThis() })

  it('should return the upload status', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready'
    })

    const request = makeStatusRequest()
    const mockH = makeStatusH()

    await uploadStatus.handler(request, mockH)

    expect(getUploadStatus).toHaveBeenCalledWith(UPLOAD_ID)
    expect(mockH.response).toHaveBeenCalledWith({
      uploadStatus: 'ready'
    })
  })

  it('emits a virus failure metric when the upload is rejected for a virus', async () => {
    // The real CDP Uploader reports a virus as the upload COMPLETING
    // (uploadStatus 'ready') with numberOfRejectedFiles > 0 and the reason on the
    // per-file errorMessage — there is no top-level 'rejected' status.
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 1,
      errorMessage: 'The selected file contains a virus'
    })

    await uploadStatus.handler(makeStatusRequest(), makeStatusH())

    expect(metricsCounter).toHaveBeenCalledWith(
      GEOPACKAGE_METRIC.validationFailed,
      1,
      { category: VALIDATION_CATEGORY.virus }
    )
  })

  it('does not emit a virus metric for a clean ready upload', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 0,
      errorMessage: null
    })

    await uploadStatus.handler(makeStatusRequest(), makeStatusH())

    expect(metricsCounter).not.toHaveBeenCalled()
  })

  it('does not emit a virus metric for a non-virus rejection', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready',
      numberOfRejectedFiles: 1,
      errorMessage: 'The selected file type is not allowed'
    })

    await uploadStatus.handler(makeStatusRequest(), makeStatusH())

    expect(metricsCounter).not.toHaveBeenCalled()
  })
})
