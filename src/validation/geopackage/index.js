import { checkAdvanceAndDelayNotBothSet } from './advance-delay-check.js'
import { checkHabitatDistinctiveness } from './distinctiveness-check.js'
import { checkDuplicateHabitatRefs } from './duplicate-ref-check.js'
import { readGeoPackage } from './geopackage.js'
import { FEATURE_READ_MODE } from './read-feature-tables.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  logPerf,
  msSince,
  perfNow
} from '../../common/helpers/perf-evidence.js'
import { getGeosWorkerPool } from './geos/worker-pool.js'

const logger = createLogger()

// The geometry checks below assume the format gate already ran and passed —
// the upload route gets both from validateAndReadGpkg in one read.

/**
 * The worker pool, with its settings read from config at first use. Started
 * lazily rather than at boot so a process that never validates anything — a
 * test, a one-off script — never pays for the workers.
 */
function workerPool() {
  return getGeosWorkerPool({
    size: config.get('validation.workerCount'),
    queueLimit: config.get('validation.workerQueueLimit'),
    timeoutMs: config.get('validation.workerTimeoutMs')
  })
}

/**
 * Run every geometry check against an open baseline GeoPackage file.
 *
 * @param {string} filePath
 * @param {string} [variant]
 * @returns {Promise<{ valid: boolean, errors: Array<{ code: string, message: string }> }>}
 */
export async function validateBaselineFile(filePath, variant) {
  // Attributes only: the geometry work happens in the worker against the file,
  // and the data-quality checks below read properties.
  const layers = readGeoPackage(filePath, FEATURE_READ_MODE.properties)
  return validateGeoPackageLayers(layers, variant, { filePath })
}

/**
 * Run the geometry and data-quality checks over already-parsed layers.
 *
 * NO DATABASE CONNECTION IS TAKEN. The geometry work runs on a worker thread
 * with GEOS-WASM; the data-quality checks are pure JavaScript. That is the whole
 * point of the exercise — validation used to hold a pooled connection for its
 * full duration, starving logins and page loads of a resource the service cannot
 * scale.
 *
 * `options.filePath` is REQUIRED for the geometry checks. The worker reads the
 * GeoPackage itself rather than being handed a structured clone of the parsed
 * layers, which would cost ~29 MB per upload and leave the synchronous parse on
 * the main thread. Callers that genuinely have no file — none in production —
 * get the data-quality checks alone.
 *
 * Throws {@link import('./geos/worker-pool.js').ValidationQueueFullError} when
 * the pool is saturated. The route turns that into a 503 telling the user to try
 * again; it is back-pressure, not a problem with their file.
 *
 * @param {object} layers Output of readGeoPackage
 * @param {string} [variant] one of EXTRACT_VARIANT; selects Baseline* vs
 *   Proposed* columns for the distinctiveness scope check. Defaults to baseline.
 * @param {object} [options]
 * @param {string} options.filePath the same GeoPackage, on local disk
 * @param {boolean} [options.includeSizes] also return per-feature areas and
 *   lengths, so the sizing pass need not re-measure the same geometry
 */
export async function validateGeoPackageLayers(
  layersOrLoad,
  variant,
  options = {}
) {
  const { filePath, includeSizes = false } = options
  if (!filePath) {
    throw new Error('validateGeoPackageLayers requires a GeoPackage file path')
  }

  // A FUNCTION here means "unpack the shapes only once a worker is free".
  //
  // The geometry work needs the file, not the parsed layers — the worker opens
  // `filePath` itself. Only the data-quality checks below need layers, and they
  // run after the pool has answered. So a caller that passes a loader keeps
  // nothing but a path while it waits in the queue, where a caller that passes
  // layers is holding the whole unpacked object graph for the entire wait —
  // 57 MB per 5,000-parcel file, 121 MB per 12,000-parcel one, times the queue
  // depth. Both forms are supported because most callers already have layers in
  // hand and are not queueing behind anything.
  const deferLayers = typeof layersOrLoad === 'function'

  const pool = workerPool()
  const start = perfNow()
  const { valid, errors, sizes, geosVersion, queueWaitMs } = await pool.run(
    filePath,
    { includeSizes }
  )
  const stats = pool.stats()
  logPerf(logger, 'geos-worker-validate', {
    validateMs: msSince(start),
    queueWaitMs,
    geosVersion,
    ...stats
  })

  // Now — and only now — are the shapes needed. Unpacking here rather than
  // before the queue is the whole point: the wait costs a path, not a heap.
  const layers = deferLayers ? layersOrLoad() : layersOrLoad

  // JS-side checks that don't need geometry. Surface ahead of geometry errors so
  // the user sees blocking policy/data-quality issues first.
  const dataQualityErrors = [
    checkHabitatDistinctiveness(layers, variant),
    checkDuplicateHabitatRefs(layers),
    checkAdvanceAndDelayNotBothSet(layers)
  ].filter(Boolean)

  // Handed back so the route can promote them to metrics. They are measured
  // here because this is the only place that sees both the pool and the clock,
  // and emitted there because the route owns the per-request metric budget.
  const poolTelemetry = { queueWaitMs, queueDepth: stats.queued }

  if (dataQualityErrors.length === 0) {
    return { valid, errors, sizes, poolTelemetry }
  }
  return {
    valid: false,
    errors: [...dataQualityErrors, ...errors],
    sizes,
    poolTelemetry
  }
}
