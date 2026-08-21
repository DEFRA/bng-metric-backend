import { parentPort } from 'node:worker_threads'

import { validateAndReadGpkg } from '../../validation/geopackage/geopackage.js'

/**
 * Worker-thread entry point for the GeoPackage format gate and parse.
 *
 * This is the part of the pipeline that has to leave the request loop. The
 * SQLite read and the WKB -> GeoJSON decode are pure synchronous CPU
 * (`read-feature-tables.js` contains no await at all), so on the main thread
 * they block every unrelated request for their whole duration — measured at
 * ~270ms for a 5.6MB file, and it scales with the file. Running them here
 * leaves the main loop free to serve everyone else.
 *
 * Only the parse lives here. The rest of the pipeline (PostGIS checks, extract,
 * enrich, persist) needs database access, which would mean a second connection
 * pool per thread and would put writes outside the persist-project chokepoint.
 * Those stages are await-heavy, so they yield to other requests anyway.
 */
parentPort.on('message', ({ buffer }) => {
  try {
    const { valid, errors, layers } = validateAndReadGpkg(
      Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    )
    parentPort.postMessage({ ok: true, valid, errors, layers })
  } catch (error) {
    // Error instances do not survive structured clone with their prototype, so
    // send the parts the dispatcher actually reports.
    parentPort.postMessage({
      ok: false,
      name: error.name,
      message: error.message
    })
  }
})
