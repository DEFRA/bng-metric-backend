import { createServer } from '../../src/server.js'
import { routeRecorder } from './route-recorder.js'

async function startServer() {
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
