/**
 * Which geometry engine runs, and what happens when the new one cannot.
 *
 * `validation.engine` selects between three modes, and it is an environment
 * variable rather than a code path so that switching back is a restart, not a
 * deploy:
 *
 *   postgis  the SQL statement (the default, and the fallback for the others)
 *   geos     in-process GEOS-WASM on a worker thread
 *   shadow   both, returning the PostGIS answer and reporting any difference
 *
 * FALLBACK IS THE WHOLE SAFETY STORY. Anything that stops the GEOS path
 * producing an answer — a full queue, an overrunning worker, a crashed thread,
 * or simply no file path to hand a worker — falls back to PostGIS and records
 * why. The user sees a slightly slower upload; they never see a failure that the
 * old engine would not also have produced.
 */
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { metricsCounter } from '../../common/helpers/metrics.js'
import { GEOPACKAGE_METRIC } from '../../common/helpers/metric-names.js'
import {
  logPerf,
  msSince,
  perfNow
} from '../../common/helpers/perf-evidence.js'
import { validateGeoPackageLayersPostgis } from './postgis/index.js'
import { getGeosWorkerPool } from './geos/worker-pool.js'
import { compareEngineResults, divergenceDetail } from './geos/shadow.js'

const logger = createLogger()

export const VALIDATION_ENGINE = Object.freeze({
  postgis: 'postgis',
  geos: 'geos',
  shadow: 'shadow'
})

/**
 * Reasons a request that asked for GEOS got PostGIS instead. Values are a
 * metric dimension, so the set stays small and fixed.
 */
const FALLBACK_REASON = Object.freeze({
  noFilePath: 'no_file_path',
  queueFull: 'queue_full',
  workerFailed: 'worker_failed'
})

/** The worker pool, with its settings read from config at first use. */
function workerPool() {
  return getGeosWorkerPool({
    size: config.get('validation.workerCount'),
    queueLimit: config.get('validation.workerQueueLimit'),
    timeoutMs: config.get('validation.workerTimeoutMs')
  })
}

/**
 * Map a worker-pool failure onto its metric reason. A full queue is ordinary
 * back-pressure and expected under load; anything else is a fault worth
 * separating from it on the dashboard.
 */
function fallbackReason(error) {
  return error?.name === 'ValidationQueueFullError'
    ? FALLBACK_REASON.queueFull
    : FALLBACK_REASON.workerFailed
}

async function recordFallback(reason, detail) {
  logger.warn(`geometry validation fell back to postgis (${reason}): ${detail}`)
  await metricsCounter(GEOPACKAGE_METRIC.validationEngineFallback, 1, {
    reason
  })
}

/**
 * Run the GEOS engine on a worker, or return null if it could not be run.
 *
 * @param {string|undefined} filePath
 * @param {boolean} includeSizes
 * @returns {Promise<object|null>}
 */
async function tryGeos(filePath, includeSizes) {
  if (!filePath) {
    // Every production caller threads the downloaded file through; a caller
    // holding only parsed layers (a test, or a future path) is not worth
    // paying a 17 MB structured clone for.
    await recordFallback(
      FALLBACK_REASON.noFilePath,
      'no file path was supplied to the validator'
    )
    return null
  }
  const pool = workerPool()
  const start = perfNow()
  try {
    const result = await pool.run(filePath, { includeSizes })
    // Rides on the perf-evidence switch deliberately: this is rollout
    // instrumentation, wanted while the engine is being proved and no longer
    // wanted afterwards. The durable operational view is the metrics above.
    logPerf(logger, 'geos-worker-validate', {
      validateMs: msSince(start),
      geosVersion: result.geosVersion,
      ...pool.stats()
    })
    return result
  } catch (error) {
    await recordFallback(fallbackReason(error), error.message)
    return null
  }
}

/**
 * Run both engines and report any disagreement, returning the PostGIS answer.
 *
 * The GEOS side is strictly best-effort: it runs after the PostGIS result is
 * already in hand, and a failure to produce one is recorded as a fallback and
 * then ignored. Shadow mode must not be able to affect a user's upload — that
 * is the only reason it is safe to run in production.
 */
async function runShadow(pool, layers, filePath) {
  // Run the two side by side rather than one after the other. Shadow mode is
  // meant to be soaked in a real environment, and a user should wait roughly
  // what they wait today — the slower of the two — rather than the sum. The
  // GEOS side never asks for sizes: shadow must not be able to change what is
  // persisted, only what is reported.
  const [postgis, geos] = await Promise.all([
    validateGeoPackageLayersPostgis(pool, layers),
    tryGeos(filePath, false)
  ])
  if (!geos) {
    return postgis
  }

  const comparison = compareEngineResults(postgis, geos)
  if (!comparison.diverged) {
    return postgis
  }

  logger.warn(
    {
      validationEngineDivergence: comparison.kind,
      filePath,
      geosVersion: geos.geosVersion,
      ...divergenceDetail(postgis, geos)
    },
    `geometry validation engines diverged (${comparison.kind}): postgis=[${comparison.postgisCodes}] geos=[${comparison.geosCodes}]`
  )
  await metricsCounter(GEOPACKAGE_METRIC.validationEngineDivergence, 1, {
    kind: comparison.kind
  })
  return postgis
}

/**
 * Run the geometry checks with whichever engine is configured.
 *
 * @param {object} params
 * @param {object} params.layers parsed GeoPackage layers
 * @param {import('pg').Pool} params.pool
 * @param {string} [params.filePath] the uploaded file on local disk — required
 *   for the GEOS engine, which parses it on the worker rather than being handed
 *   a clone of the layers
 * @param {boolean} [params.includeSizes] ask the GEOS engine for per-feature
 *   areas and lengths, so the sizing pass need not re-measure the same geometry
 * @returns {Promise<{ valid: boolean, errors: object[], sizes?: object }>}
 */
export async function runGeometryValidation({
  layers,
  pool,
  filePath,
  includeSizes = false
}) {
  const engine = config.get('validation.engine')

  if (engine === VALIDATION_ENGINE.geos) {
    const geos = await tryGeos(filePath, includeSizes)
    if (geos) {
      return geos
    }
    return validateGeoPackageLayersPostgis(pool, layers)
  }

  if (engine === VALIDATION_ENGINE.shadow) {
    return runShadow(pool, layers, filePath)
  }

  return validateGeoPackageLayersPostgis(pool, layers)
}
