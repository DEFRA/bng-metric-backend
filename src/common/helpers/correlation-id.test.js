import Hapi from '@hapi/hapi'
import hapiPino from 'hapi-pino'
import { PassThrough } from 'node:stream'
import { describe, expect, test, vi } from 'vitest'

import {
  getCorrelationId,
  requestCorrelation,
  sessionCorrelationId
} from './correlation-id.js'

function captureLogStream() {
  const stream = new PassThrough()
  const logs = []
  let buffer = ''

  stream.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.trim()) {
        logs.push(JSON.parse(line))
      }
    }
  })

  return { stream, logs }
}

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

  test('Should bind the verified session id to the existing request logger as session.id', async () => {
    const server = Hapi.server()
    const logger = { child: vi.fn().mockReturnValue('session-logger') }

    server.ext('onRequest', (request, h) => {
      request.logger = logger
      return h.continue
    })
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
      handler: (request) => ({ logger: request.logger })
    })

    const response = await server.inject('/')

    expect(logger.child).toHaveBeenCalledWith({
      session: { id: 'session-id' }
    })
    expect(response.result).toEqual({ logger: 'session-logger' })
  })

  test('Should emit session.id on the hapi-pino response log', async () => {
    const { stream, logs } = captureLogStream()
    const server = Hapi.server()

    server.auth.scheme('test-auth', () => ({
      authenticate: (_request, h) =>
        h.authenticated({ credentials: { sessionId: 'session-id' } })
    }))
    server.auth.strategy('test-auth', 'test-auth')
    server.auth.default('test-auth')

    await server.register({
      plugin: hapiPino,
      options: {
        stream,
        logEvents: ['response'],
        level: 'info'
      }
    })
    await server.register(requestCorrelation)

    server.route({
      method: 'GET',
      path: '/',
      handler: () => 'ok'
    })

    await server.inject('/')
    await new Promise((resolve) => setImmediate(resolve))

    const responseLog = logs.find((log) => log.msg?.startsWith('[response]'))

    expect(responseLog).toMatchObject({
      session: { id: 'session-id' }
    })
  })
})
