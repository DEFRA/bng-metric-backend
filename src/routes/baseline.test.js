const { validateBaseline } = await import('./baseline.js')

describe('POST /baseline/validate/{uploadId}', () => {
  it('should return valid for any upload (stub)', async () => {
    const request = {
      params: { uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147' }
    }

    const mockH = {
      response: vi.fn().mockReturnThis()
    }

    await validateBaseline.handler(request, mockH)

    expect(mockH.response).toHaveBeenCalledWith({ valid: true })
  })
})
