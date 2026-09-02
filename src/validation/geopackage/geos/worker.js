/**
 * Worker-thread entry point for GEOS geometry validation.
 *
 * GEOS is synchronous C code. Run on the main thread it holds the event loop
 * for the whole validation — measured at 2,344 ms of lag on a 5,000-parcel file,
 * during which the instance serves nothing else. Worker threads are therefore
 * not an optimisation here, they are the reason the approach is viable at all.
 *
 * WHAT CROSSES THE BOUNDARY, AND WHY IT IS A FILE PATH
 *
 * The worker is given the path to the uploaded GeoPackage on local disk, not
 * the parsed layers. Posting parsed layers would mean a structured clone of a
 * ~17 MB object graph per upload, and would leave the synchronous better-sqlite3
 * parse on the main thread — the very thing worth moving. Reading the file here
 * costs a second parse (57 ms at 5,000 parcels) but pays for itself several
 * times over, and on a rejected file — disproportionately the slow ones — the
 * main thread never has to look at the geometry again at all.
 *
 * What comes back is a verdict: error codes with their rendered messages and
 * payloads, plus optional per-feature sizes. Small, and independent of file size.
 */
import { parentPort } from 'node:worker_threads'

import { readGeoPackage } from '../geopackage.js'
import { validateGeoPackageLayersGeos } from './index.js'
import { loadGeosRuntime } from './geos-runtime.js'

/** Message type the pool sends to ask for a validation. */
const VALIDATE = 'validate'

/**
 * Compile the WebAssembly module before announcing readiness, so the first
 * real upload does not pay for it. The pool waits for this message before
 * handing the worker any work.
 */
const runtime = await loadGeosRuntime()
parentPort.postMessage({ ready: true, geosVersion: runtime.version })

parentPort.on('message', async (message) => {
  if (message?.type !== VALIDATE) {
    return
  }
  const { jobId, filePath, includeSizes } = message
  try {
    const layers = readGeoPackage(filePath)
    const result = await validateGeoPackageLayersGeos(layers, { includeSizes })
    parentPort.postMessage({ jobId, result })
  } catch (error) {
    // Errors do not survive a structured clone with their prototype intact, so
    // the pool rebuilds one from these two fields.
    parentPort.postMessage({
      jobId,
      error: { message: error.message, stack: error.stack }
    })
  }
})

export { VALIDATE }
