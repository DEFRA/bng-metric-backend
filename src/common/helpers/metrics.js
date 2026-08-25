import { Metrics } from '@defra/cdp-metrics'

import { config } from '../../config.js'
import { createLogger } from './logging/logger.js'

/**
 * Run one metric emission under the shared guard/error policy.
 *
 * Guarded by `isMetricsEnabled`, which defaults to `NODE_ENV === 'production'`.
 * That keys off how the process was started, NOT which environment it is
 * deployed to: `npm start` sets NODE_ENV=production, so metrics are ON in every
 * deployed environment (dev, test, perf-test and prod alike) and OFF only for
 * local `npm run dev`, Docker Compose and the unit tests. Set ENABLE_METRICS to
 * override it for one environment.
 *
 * Any failure is swallowed and logged — metrics must never break the request
 * that emits them.
 *
 * Each call constructs its own `Metrics` and flushes on completion, so a metric
 * costs one EMF flush. Emit per request or per pipeline stage; never per
 * feature, or the flushes cost more than the work being measured.
 *
 * @param {(metrics: Metrics) => Promise<void>} emit
 * @returns {Promise<void>}
 */
const withMetrics = async (emit) => {
  if (!config.get('isMetricsEnabled')) {
    return
  }

  try {
    await emit(new Metrics(createLogger()))
  } catch (error) {
    createLogger().error(error, error.message)
  }
}

/**
 * Emit a Count metric to CloudWatch via EMF.
 *
 * @param {string} name
 * @param {number} [value=1]
 * @param {Record<string, string>} [dimensions={}]
 * @returns {Promise<void>}
 */
const metricsCounter = async (name, value = 1, dimensions = {}) =>
  withMetrics((metrics) => metrics.counter(name, value, dimensions))

/**
 * Emit a Bytes metric to CloudWatch via EMF.
 *
 * @param {string} name
 * @param {number} value - size in bytes
 * @param {Record<string, string>} [dimensions={}]
 * @returns {Promise<void>}
 */
const metricsByteSize = async (name, value, dimensions = {}) =>
  withMetrics((metrics) => metrics.byteSize(name, value, dimensions))

/**
 * Emit a Milliseconds metric to CloudWatch via EMF. This is the one that turns
 * a measured duration into something a Grafana dashboard can chart a p95 of and
 * alert on — a pino log line carrying the same number cannot be aggregated.
 *
 * @param {string} name
 * @param {number} value - duration in milliseconds
 * @param {Record<string, string>} [dimensions={}]
 * @returns {Promise<void>}
 */
const metricsMillis = async (name, value, dimensions = {}) =>
  withMetrics((metrics) => metrics.millis(name, value, dimensions))

/**
 * Emit a unitless gauge metric to CloudWatch via EMF, for point-in-time
 * magnitudes (feature counts, row counts) that give a duration its scale.
 *
 * @param {string} name
 * @param {number} value
 * @param {Record<string, string>} [dimensions={}]
 * @returns {Promise<void>}
 */
const metricsGauge = async (name, value, dimensions = {}) =>
  withMetrics((metrics) => metrics.gauge(name, value, dimensions))

export { metricsCounter, metricsByteSize, metricsMillis, metricsGauge }
