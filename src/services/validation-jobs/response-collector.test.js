import { describe, it, expect } from 'vitest'

import { createResponseCollector } from './response-collector.js'
import { HTTP_STATUS } from '../../common/helpers/http/status-codes.js'

describe('createResponseCollector', () => {
  it('captures the payload a bare h.response() call would have sent', () => {
    const { toolkit, captured } = createResponseCollector()

    toolkit.response({ valid: true, errors: [] })

    expect(captured.payload).toEqual({ valid: true, errors: [] })
    expect(captured.statusCode).toBe(HTTP_STATUS.OK)
  })

  it('captures a status code set with .code()', () => {
    const { toolkit, captured } = createResponseCollector()

    toolkit.response({ valid: false }).code(HTTP_STATUS.INTERNAL_SERVER_ERROR)

    expect(captured.statusCode).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    expect(captured.payload).toEqual({ valid: false })
  })

  it('returns a chainable object from .code(), as Hapi does', () => {
    const { toolkit, captured } = createResponseCollector()

    const response = toolkit.response({}).code(HTTP_STATUS.CONFLICT)

    expect(response.code).toBeTypeOf('function')
    expect(captured.statusCode).toBe(HTTP_STATUS.CONFLICT)
  })

  it('keeps only the last response when the pipeline answers more than once', () => {
    const { toolkit, captured } = createResponseCollector()

    toolkit.response({ first: true }).code(HTTP_STATUS.CONFLICT)
    toolkit.response({ second: true })

    // The second call resets the status too — a later plain response() is a
    // 200, not a 200 body wearing the earlier code.
    expect(captured.payload).toEqual({ second: true })
    expect(captured.statusCode).toBe(HTTP_STATUS.OK)
  })
})
