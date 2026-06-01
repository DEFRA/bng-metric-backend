import { Metrics } from '@defra/cdp-metrics'

import { config } from '../../config.js'
import { createLogger } from './logging/logger.js'

/**
 * Emit a Count metric to CloudWatch via EMF.
 *
 * Guarded by `isMetricsEnabled` (off in dev/test, on in production or when
 * ENABLE_METRICS=true) so nothing is attempted from local dev. Any failure is
 * swallowed and logged — metrics must never break the request that emits them.
 *
 * @param {string} name
 * @param {number} [value=1]
 * @param {Record<string, string>} [dimensions={}]
 * @returns {Promise<void>}
 */
const metricsCounter = async (name, value = 1, dimensions = {}) => {
  if (!config.get('isMetricsEnabled')) {
    return
  }

  try {
    await new Metrics(createLogger()).counter(name, value, dimensions)
  } catch (error) {
    createLogger().error(error, error.message)
  }
}

/**
 * Emit a Bytes metric to CloudWatch via EMF. Same guard/error semantics as
 * {@link metricsCounter}.
 *
 * @param {string} name
 * @param {number} value - size in bytes
 * @param {Record<string, string>} [dimensions={}]
 * @returns {Promise<void>}
 */
const metricsByteSize = async (name, value, dimensions = {}) => {
  if (!config.get('isMetricsEnabled')) {
    return
  }

  try {
    await new Metrics(createLogger()).byteSize(name, value, dimensions)
  } catch (error) {
    createLogger().error(error, error.message)
  }
}

export { metricsCounter, metricsByteSize }
