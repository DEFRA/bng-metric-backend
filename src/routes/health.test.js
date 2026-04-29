import { describe, test, expect, vi } from 'vitest'
import { health } from './health.js'

describe('#health', () => {
  test('Should return success message', () => {
    const mockResponse = vi.fn().mockReturnValue('ok')
    const h = { response: mockResponse }

    health.handler({}, h)

    expect(mockResponse).toHaveBeenCalledWith({ message: 'success' })
  })
})
