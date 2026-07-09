import { AsyncLocalStorage } from 'node:async_hooks'

import { sessionCorrelationIdSymbol } from './session-correlation-id-symbol.js'

const storage = new AsyncLocalStorage()

function getCorrelationId() {
  return storage.getStore()?.get('correlationId')
}

function normaliseCorrelationId(value) {
  if (typeof value !== 'string') {
    return null
  }
  return value.trim() || null
}

function sessionCorrelationId(credentials) {
  return (
    normaliseCorrelationId(credentials?.sessionId) ??
    normaliseCorrelationId(credentials?.correlationId) ??
    normaliseCorrelationId(credentials?.sid)
  )
}

function setCorrelationId(correlationId) {
  const store = storage.getStore()
  if (store && correlationId) {
    store.set('correlationId', correlationId)
  }
}

function wrapCycle(request, cycle, store) {
  const requestCycle = request[cycle].bind(request)
  request[cycle] = () => storage.run(store, requestCycle)
}

const requestCorrelation = {
  plugin: {
    name: 'request-correlation',
    register(server) {
      server.ext('onRequest', (request, h) => {
        const store = new Map()
        wrapCycle(request, '_lifecycle', store)
        wrapCycle(request, '_postCycle', store)

        return h.continue
      })

      server.ext('onPostAuth', (request, h) => {
        const correlationId = sessionCorrelationId(request.auth?.credentials)
        setCorrelationId(correlationId)

        if (correlationId && request.logger) {
          // hapi-pino response logs run outside the ALS context. Store the id on a
          // symbol so logger-options.js can prefix the message without emitting a
          // structured session.id field that CDP may strip.
          request.logger[sessionCorrelationIdSymbol] = correlationId
        }

        return h.continue
      })
    }
  }
}

export { getCorrelationId, requestCorrelation, sessionCorrelationId }
