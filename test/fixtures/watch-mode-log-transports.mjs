// Run by src/common/helpers/logging/watch-mode-transports.test.js under
// `node --watch-path`, as `npm run dev` runs the backend. Starts a pino-pretty
// transport from every copy of pino the backend installs, logs through each,
// and reports once the transport workers have had time to fail.
//
// On Node 24.22, watch mode sends worker threads messages of its own, and
// thread-stream before 3.2.0 crashes on them ("this should not happen:
// undefined"), which stopped the backend starting under `npm run dev`.
import { createRequire } from 'node:module'

// The backend's own logger, hapi-pino's request logging and cdp-auditing's
// audit events each bring their own copy of pino.
const PINO_OWNERS = ['hapi-pino', '@defra/cdp-auditing']

// How long to wait after logging. A crashing worker fails within a few
// milliseconds of its first message.
const SETTLE_MS = 1000

function pinoPaths() {
  const paths = new Set([createRequire(import.meta.url).resolve('pino')])
  for (const owner of PINO_OWNERS) {
    paths.add(createRequire(import.meta.resolve(owner)).resolve('pino'))
  }
  return [...paths]
}

const loggers = []
for (const pinoPath of pinoPaths()) {
  const { pino } = await import(pinoPath)
  loggers.push(pino({ transport: { target: 'pino-pretty' } }))
}

for (const logger of loggers) {
  logger.info('logged through the transport')
}

await Promise.all(
  loggers.map((logger) => new Promise((resolve) => logger.flush(resolve)))
)
setTimeout(() => {
  console.log(`TRANSPORTS_OK ${loggers.length}`)
}, SETTLE_MS)
