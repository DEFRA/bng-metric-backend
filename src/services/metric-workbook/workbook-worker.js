import { parentPort } from 'node:worker_threads'

import { buildMetricWorkbook } from './build-metric-workbook.js'

/**
 * Worker-thread entry point: builds one metric workbook and exits. See
 * build-in-worker.js for why it runs here and not on the main thread.
 *
 * The bytes are copied out of the writer's Buffer before being transferred,
 * since a Buffer can be a view on a larger, shared allocation that must not be
 * detached. The copy is a few milliseconds for a 4.5 MB file.
 */
parentPort.once('message', async ({ project, format, now }) => {
  try {
    const workbook = await buildMetricWorkbook(project, { format, now })
    const bytes = Uint8Array.prototype.slice.call(workbook)
    parentPort.postMessage({ bytes }, [bytes.buffer])
  } catch (error) {
    parentPort.postMessage({
      error: { message: error.message, stack: error.stack }
    })
  }
})
