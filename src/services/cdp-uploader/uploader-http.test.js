import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Boom from '@hapi/boom'
import Wreck from '@hapi/wreck'

import { uploaderGet, uploaderPost } from './uploader-http.js'

vi.mock('@hapi/wreck', () => ({
  default: {
    request: vi.fn(),
    read: vi.fn()
  }
}))

const URL = 'http://localhost:7337/status/abc-123'
const TIMEOUT_MS = 5000
const HEADERS_TOOK_MS = 3000
const OK = 200
const BAD_GATEWAY = 502
const GATEWAY_TIMEOUT = 504

function response(statusCode = OK) {
  return {
    statusCode,
    statusMessage: statusCode === OK ? 'OK' : 'Bad Gateway',
    headers: {},
    destroy: vi.fn()
  }
}

describe('uploader-http', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the response and its parsed body', async () => {
    const res = response()
    vi.mocked(Wreck.request).mockResolvedValue(res)
    vi.mocked(Wreck.read).mockResolvedValue({ uploadStatus: 'ready' })

    const result = await uploaderGet(URL, TIMEOUT_MS)

    expect(result).toEqual({ res, payload: { uploadStatus: 'ready' } })
    expect(Wreck.request).toHaveBeenCalledWith('GET', URL, {
      timeout: TIMEOUT_MS
    })
  })

  it('gives the body only the time the headers left, so a call never takes twice the timeout', async () => {
    vi.mocked(Wreck.request).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + HEADERS_TOOK_MS)
      return response()
    })
    vi.mocked(Wreck.read).mockResolvedValue({})

    await uploaderGet(URL, TIMEOUT_MS)

    expect(Wreck.read).toHaveBeenCalledWith(expect.anything(), {
      json: true,
      timeout: TIMEOUT_MS - HEADERS_TOOK_MS
    })
  })

  it('never gives the body a timeout of 0, which Wreck reads as none', async () => {
    vi.mocked(Wreck.request).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + TIMEOUT_MS + HEADERS_TOOK_MS)
      return response()
    })
    vi.mocked(Wreck.read).mockResolvedValue({})

    await uploaderGet(URL, TIMEOUT_MS)

    expect(vi.mocked(Wreck.read).mock.calls[0][1].timeout).toBe(1)
  })

  it('answers a stalled body as a 504 and drops the response', async () => {
    const res = response()
    vi.mocked(Wreck.request).mockResolvedValue(res)
    vi.mocked(Wreck.read).mockRejectedValue(Boom.clientTimeout())

    await expect(uploaderGet(URL, TIMEOUT_MS)).rejects.toMatchObject({
      message: 'Client request timeout',
      output: { statusCode: GATEWAY_TIMEOUT }
    })
    expect(res.destroy).toHaveBeenCalled()
  })

  it('throws an error answer with its body, as the Wreck shortcuts do', async () => {
    vi.mocked(Wreck.request).mockResolvedValue(response(BAD_GATEWAY))
    vi.mocked(Wreck.read).mockResolvedValue({ message: 'down' })

    await expect(uploaderGet(URL, TIMEOUT_MS)).rejects.toMatchObject({
      output: { statusCode: BAD_GATEWAY },
      data: { isResponseError: true, payload: { message: 'down' } }
    })
  })

  it('posts the payload and headers with the timeout', async () => {
    vi.mocked(Wreck.request).mockResolvedValue(response())
    vi.mocked(Wreck.read).mockResolvedValue({ uploadId: 'abc-123' })
    const options = {
      payload: '{}',
      headers: { 'Content-Type': 'application/json' }
    }

    await uploaderPost('http://localhost:7337/initiate', options, TIMEOUT_MS)

    expect(Wreck.request).toHaveBeenCalledWith(
      'POST',
      'http://localhost:7337/initiate',
      { ...options, timeout: TIMEOUT_MS }
    )
  })
})
