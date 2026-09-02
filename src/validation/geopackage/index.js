import { checkAdvanceAndDelayNotBothSet } from './advance-delay-check.js'
import { checkHabitatDistinctiveness } from './distinctiveness-check.js'
import { checkDuplicateHabitatRefs } from './duplicate-ref-check.js'
import { readGeoPackage } from './geopackage.js'
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
  const layers = readGeoPackage(filePath)
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
export async function validateGeoPackageLayers(layers, variant, options = {}) {
  const { filePath, includeSizes = false } = options
  if (!filePath) {
    throw new Error('validateGeoPackageLayers requires a GeoPackage file path')
  }

  const pool = workerPool()
  const start = perfNow()
  const { valid, errors, sizes, geosVersion } = await pool.run(filePath, {
    includeSizes
  })
  logPerf(logger, 'geos-worker-validate', {
    validateMs: msSince(start),
    geosVersion,
    ...pool.stats()
  })

  // JS-side checks that don't need geometry. Surface ahead of geometry errors so
  // the user sees blocking policy/data-quality issues first.
  const dataQualityErrors = [
    checkHabitatDistinctiveness(layers, variant),
    checkDuplicateHabitatRefs(layers),
    checkAdvanceAndDelayNotBothSet(layers)
  ].filter(Boolean)

  if (dataQualityErrors.length === 0) {
    return { valid, errors, sizes }
  }
  return { valid: false, errors: [...dataQualityErrors, ...errors], sizes }
}
