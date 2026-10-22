import { createLogger } from '../common/helpers/logging/logger.js'
import { metricsGauge, metricsMillis } from '../common/helpers/metrics.js'
import {
  PERFORMANCE_METRIC,
  VALIDATION_METRIC
} from '../common/helpers/metric-names.js'
import {
  logPerf,
  memoryUsageMb,
  msSince
} from '../common/helpers/perf-evidence.js'

/**
 * The validate routes' metrics: what each pipeline stage cost, and the worker
 * pool's health after each trip. Split out of validate-geopackage-route.js to
 * keep the route within Sonar's file size.
 */

const logger = createLogger()

/**
 * Record one pipeline stage twice over, because the two destinations answer
 * different questions and neither substitutes for the other:
 *
 *   - a `pipeline-inline` evidence LINE, carrying the high-cardinality detail
 *     (uploadId, feature counts) that you need when investigating one slow
 *     upload in the logs;
 *   - an EMF duration METRIC, carrying only a two-valued `documentKey`
 *     dimension, which is what CloudWatch aggregates and Grafana charts.
 *
 * Both come off the same measurement, so a dashboard and a log line can never
 * disagree about how long a stage took.
 *
 * @param {string} metricName one of PERFORMANCE_METRIC
 * @param {number} durationMs
 * @param {object} fields evidence-line fields (must include `stage`)
 * @param {object} config route config carrying projectDocumentKey
 */
export async function recordStage(metricName, durationMs, fields, config) {
  logPerf(logger, 'pipeline-inline', { ...fields, elapsedMs: durationMs })
  await metricsMillis(metricName, durationMs, {
    documentKey: config.projectDocumentKey
  })
}

/**
 * Promote the worker pool's own numbers to metrics.
 *
 * These are the LEADING indicators. `GeoPackageValidationBusy` only moves once
 * users are being turned away; queue depth and wait time start climbing well
 * before that. Resident memory rides along because it is the figure that decides
 * whether adding workers is even an option — the workers share this process, and
 * their WebAssembly heaps never shrink.
 *
 * Sampled once per validation rather than on a timer: uploads are infrequent
 * enough that this is a handful of flushes a minute, and the moment just after a
 * validation is exactly when the high-water mark is worth reading.
 */
export async function recordPoolHealth(poolTelemetry, config) {
  if (!poolTelemetry) {
    return
  }
  await metricsMillis(
    PERFORMANCE_METRIC.queueWaitMs,
    poolTelemetry.queueWaitMs,
    { documentKey: config.projectDocumentKey }
  )
  await metricsGauge(
    VALIDATION_METRIC.workerQueueDepth,
    poolTelemetry.queueDepth
  )
  await metricsGauge(VALIDATION_METRIC.processResidentMb, memoryUsageMb().rssMb)
}

/**
 * Record what the checks cost, whatever they found: the parse and
 * geometry-validate stages, the feature count, and the pool's health after
 * each worker trip — one per stage checked.
 *
 * @param {{ uploadId: string, fileSize?: number | null, gateMs: number, featureCount: number, validateStart: number }} measured
 * @param {Array<{ poolTelemetry?: object } | null>} checks each stage's verdict
 * @param {object} config route config carrying projectDocumentKey
 */
export async function recordValidationMetrics(measured, checks, config) {
  const { uploadId, fileSize, gateMs, featureCount, validateStart } = measured
  // Recorded here rather than before the queue because that is where the read
  // now happens. `gateMs` is the cheap structural pass in front of the queue;
  // the rest of this stage's time is the unpack, which the pool wait separates
  // from it.
  await recordStage(
    PERFORMANCE_METRIC.parseMs,
    gateMs,
    {
      uploadId,
      stage: 'parse',
      fileSizeBytes: fileSize ?? null,
      featureCount,
      valid: true
    },
    config
  )
  await metricsGauge(PERFORMANCE_METRIC.featureCount, featureCount, {
    documentKey: config.projectDocumentKey
  })
  for (const check of checks) {
    await recordPoolHealth(check?.poolTelemetry, config)
  }
  await recordStage(
    PERFORMANCE_METRIC.geometryValidateMs,
    msSince(validateStart),
    {
      uploadId,
      stage: 'geometry-validate',
      featureCount
    },
    config
  )
}
