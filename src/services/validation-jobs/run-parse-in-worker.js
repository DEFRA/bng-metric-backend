import { Worker } from 'node:worker_threads'

const WORKER_URL = new URL('./parse-worker.js', import.meta.url)

/**
 * Parse and gate a GeoPackage on a worker thread.
 *
 * One worker per job, deliberately. A pooled worker would save the ~300ms
 * startup, but the caller is a background job whose client is polling, so that
 * latency is invisible — and a fresh thread per job means no state leaks
 * between uploads and a crashed worker needs no recovery beyond failing its own
 * job.
 *
 * The buffer is *transferred* rather than copied where it owns its memory, so a
 * 100MB upload does not briefly exist twice.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ valid: boolean, errors: object[], layers: object | null }>}
 */
function runParseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL)
    let settled = false

    const finish = (fn, value) => {
      if (settled) {
        return
      }
      settled = true
      worker.terminate().catch(() => {
        // The worker is already going away; nothing useful to do here.
      })
      fn(value)
    }

    worker.on('message', (message) => {
      if (message.ok) {
        finish(resolve, {
          valid: message.valid,
          errors: message.errors,
          layers: message.layers
        })
        return
      }
      finish(reject, workerError(message.name, message.message))
    })

    // 'error' covers a thrown module-load failure; 'exit' catches the worker
    // dying outright (an OOM abort, say) without ever reporting.
    worker.on('error', (error) => finish(reject, error))
    worker.on('exit', (code) => {
      finish(
        reject,
        new Error(`Validation worker exited unexpectedly with code ${code}`)
      )
    })

    const { payload, transfer } = transferable(buffer)
    worker.postMessage({ buffer: payload }, transfer)
  })
}

function workerError(name, message) {
  const error = new Error(message)
  error.name = name ?? 'Error'
  return error
}

/**
 * Transfer the buffer's memory when it owns its whole ArrayBuffer; copy when it
 * is a view into Node's shared pool, where detaching would take unrelated
 * buffers with it. Small buffers are pooled, large ones are not — so uploads,
 * the case that matters, take the zero-copy path.
 */
function transferable(buffer) {
  const ownsItsMemory =
    buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
  if (ownsItsMemory) {
    return { payload: buffer, transfer: [buffer.buffer] }
  }
  return { payload: buffer, transfer: [] }
}

export { runParseInWorker }
