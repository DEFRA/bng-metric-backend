import { createServer } from '../../src/server.js'
import { routeRecorder } from './route-recorder.js'
import { initTestJwks } from './auth-tokens.js'

async function startServer() {
  // Generate the test signing key and publish the shared HMAC secret BEFORE
  // createServer() runs, so the 'defra-jwt' strategy verifies the forwarded
  // x-defra-id-* headers the test helpers produce. AUTH_FORWARD_SECRET is set in
  // vitest.integration.config.js so src/config.js can validate it at import.
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
