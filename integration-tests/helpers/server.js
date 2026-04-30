import { createServer } from '../../src/server.js'

async function startServer() {
  const server = await createServer()
  await server.initialize()
  return server
}

async function stopServer(server) {
  if (server) {
    await server.stop()
  }
}

export { startServer, stopServer }
