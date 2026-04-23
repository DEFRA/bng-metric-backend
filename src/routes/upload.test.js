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

    const result = await initiateUpload.handler(request, {})

    expect(initiateUploadService).toHaveBeenCalledWith(request.payload)
    expect(result).toEqual({
      uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147',
      uploadUrl: '/upload-and-scan/f6b667d8-998f-4f55-8a20-204c0c289147'
    })
  })

  it('should throw a Boom badGateway when the upload service returns an error', async () => {
    vi.mocked(initiateUploadService).mockResolvedValue({
      error: 'Unable to initiate upload'
    })

    const request = {
      payload: {
        redirect: '/projects/abc/upload-received',
        s3Bucket: 'baseline-files'
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
        redirect: '/projects/abc/upload-received',
        s3Bucket: 'baseline-files'
      }
    }

    await expect(initiateUpload.handler(request, {})).rejects.toThrow(
      'Failed to initiate upload'
    )
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
