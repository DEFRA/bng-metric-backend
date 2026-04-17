import {
  initiateUpload as initiateUploadService,
  getUploadStatus
} from '../services/cdp-uploader/cdp-uploader.js'

vi.mock('../services/cdp-uploader/cdp-uploader.js')

const { initiateUpload, uploadStatus } = await import('./upload.js')

describe('POST /upload/initiate', () => {
  it('should return the upload result', async () => {
    vi.mocked(initiateUploadService).mockResolvedValue({
      uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147',
      uploadUrl: '/upload-and-scan/f6b667d8-998f-4f55-8a20-204c0c289147'
    })

    const request = {
      payload: {
        redirect: '/projects/abc/upload-received',
        s3Bucket: 'baseline-files',
        s3Path: 'baseline/',
        metadata: { projectId: 'abc' }
      }
    }

    const mockH = {
      response: vi.fn().mockReturnThis()
    }

    await initiateUpload.handler(request, mockH)

    expect(initiateUploadService).toHaveBeenCalledWith(request.payload)
    expect(mockH.response).toHaveBeenCalledWith({
      uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147',
      uploadUrl: '/upload-and-scan/f6b667d8-998f-4f55-8a20-204c0c289147'
    })
  })

  it('should respond with 500 when the upload service returns an error', async () => {
    vi.mocked(initiateUploadService).mockResolvedValue({
      error: 'Unable to initiate upload'
    })

    const request = {
      payload: {
        redirect: '/projects/abc/upload-received',
        s3Bucket: 'baseline-files'
      }
    }

    const mockH = {
      response: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis()
    }
    mockH.response = vi.fn().mockReturnValue(mockH)

    await initiateUpload.handler(request, mockH)

    expect(mockH.response).toHaveBeenCalledWith({
      error: 'Unable to initiate upload'
    })
    expect(mockH.code).toHaveBeenCalledWith(500)
  })
})

describe('GET /upload/{uploadId}/status', () => {
  it('should return the upload status', async () => {
    vi.mocked(getUploadStatus).mockResolvedValue({
      uploadStatus: 'ready'
    })

    const request = {
      params: { uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147' }
    }

    const mockH = {
      response: vi.fn().mockReturnThis()
    }

    await uploadStatus.handler(request, mockH)

    expect(getUploadStatus).toHaveBeenCalledWith(
      'f6b667d8-998f-4f55-8a20-204c0c289147'
    )
    expect(mockH.response).toHaveBeenCalledWith({
      uploadStatus: 'ready'
    })
  })
})
