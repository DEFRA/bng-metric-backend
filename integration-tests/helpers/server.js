import { createServer } from '../../src/server.js'
import { routeRecorder } from './route-recorder.js'
import { initTestJwks } from './auth-tokens.js'

async function startServer() {
  // Publish the test JWKS + issuer/audience into the environment BEFORE
  // createServer() reads them, so the 'defra-jwt' strategy verifies test tokens
  // against a local key set instead of reaching out to OIDC discovery.
  await initTestJwks()
  const server = await createServer()
  await server.register(routeRecorder)
  await server.initialize()
  return server
}

async function stopServer(server) {
  if (server) {
    await server.stop()
  }
}

export { startServer, stopServer }
