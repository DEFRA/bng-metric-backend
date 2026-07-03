import Hapi from '@hapi/hapi'
import { describe, expect, test } from 'vitest'

import {
  getCorrelationId,
  requestCorrelation,
  sessionCorrelationId
} from './correlation-id.js'

describe('#sessionCorrelationId', () => {
  test('Should prefer the Defra ID sessionId claim', () => {
    expect(sessionCorrelationId({ sessionId: 'session-id', sid: 'sid' })).toBe(
      'session-id'
    )
  })

  test('Should fall back to the Defra ID correlationId claim', () => {
    expect(
      sessionCorrelationId({ correlationId: 'correlation-id', sid: 'sid' })
    ).toBe('correlation-id')
  })

  test('Should fall back to the sid claim', () => {
    expect(sessionCorrelationId({ sid: 'sid' })).toBe('sid')
  })

  test('Should fall back to correlationId when sessionId is blank', () => {
    expect(
      sessionCorrelationId({
        sessionId: '   ',
        correlationId: 'correlation-id',
        sid: 'sid'
      })
    ).toBe('correlation-id')
  })

  test('Should fall back to sid when sessionId is blank', () => {
    expect(sessionCorrelationId({ sessionId: '   ', sid: 'sid' })).toBe('sid')
  })

  test('Should fall back to sid when correlationId is blank', () => {
    expect(sessionCorrelationId({ correlationId: '   ', sid: 'sid' })).toBe(
      'sid'
    )
  })

  test('Should not use cid as a session correlation id', () => {
    expect(sessionCorrelationId({ cid: 'cid' })).toBeNull()
  })

  test('Should ignore empty correlation ids', () => {
    expect(sessionCorrelationId({ sessionId: '   ' })).toBeNull()
  })
})

describe('#requestCorrelation', () => {
  test('Should expose the verified session id for the request lifecycle', async () => {
    const server = Hapi.server()

    server.auth.scheme('test-auth', () => ({
      authenticate: (_request, h) =>
        h.authenticated({ credentials: { sessionId: 'session-id' } })
    }))
    server.auth.strategy('test-auth', 'test-auth')
    server.auth.default('test-auth')
    await server.register(requestCorrelation)

    server.route({
      method: 'GET',
      path: '/',
      handler: () => ({ correlationId: getCorrelationId() })
    })

    const response = await server.inject('/')

    expect(response.result).toEqual({ correlationId: 'session-id' })
  })
})
