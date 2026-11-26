import { parentPort } from 'node:worker_threads'

/**
 * Test-only stand-in for workbook-worker.js, so build-in-worker.test.js can
 * drive every way a build ends without writing a real workbook. What it does
 * is picked by `project.behaviour`.
 */

const HEAP_CHUNK = 1_000_000
const EXIT_CODE = 3

const behaviours = {
  echo({ project, format, now }) {
    const bytes = new TextEncoder().encode(
      `${format}|${project.name}|${now.toISOString()}`
    )
    parentPort.postMessage({ bytes }, [bytes.buffer])
  },
  slow(message) {
    setTimeout(() => behaviours.echo(message), message.project.delayMs)
  },
  fail() {
    parentPort.postMessage({
      error: {
        message: 'too many rows',
        stack: 'Error: too many rows\n  at worker'
      }
    })
  },
  hang() {
    setInterval(() => {
      // Never replies; kept alive until terminated.
    }, HEAP_CHUNK)
  },
  exit() {
    process.exit(EXIT_CODE)
  },
  heap() {
    const hoard = []
    for (;;) {
      hoard.push(new Array(HEAP_CHUNK).fill({ hoard }))
    }
  }
}

parentPort.once('message', (message) => {
  behaviours[message.project.behaviour](message)
})
