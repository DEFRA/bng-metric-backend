import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

function getCorrelationId() {
  return storage.getStore()?.get('correlationId')
}

function sessionCorrelationId(credentials) {
  const correlationId =
    credentials?.sessionId ?? credentials?.sid ?? credentials?.cid
  if (typeof correlationId !== 'string') {
    return null
  }
  return correlationId.trim() || null
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
        setCorrelationId(sessionCorrelationId(request.auth?.credentials))

        return h.continue
      })
    }
  }
}

export { getCorrelationId, requestCorrelation, sessionCorrelationId }
