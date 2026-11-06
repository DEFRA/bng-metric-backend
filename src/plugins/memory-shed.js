import process from 'node:process'

import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { metricsCounter } from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_BUSY_REASON
} from '../common/helpers/metric-names.js'
import { ERROR_CODES, makeError } from '../validation/geopackage/errors.js'
import { taskMemoryBytes } from '../common/helpers/task-memory.js'

const logger = createLogger()

// The CDP health check. Never refused: a task whose RSS stays high after a
// burst would otherwise fail its health check and be replaced, ending every
// request in flight — the outcome this backstop exists to prevent.
const HEALTH_PATH = '/health'

// Below this a derived ceiling would sit at or under the process's warm
// baseline (~450 MB, up to ~565 MB with two workers; docs/geometry-validation.md)
// and refuse requests on an idle task, so the backstop stays off and says why.
const MIN_DERIVED_CEILING_BYTES = 1024 * 1024 * 1024

/**
 * The ceiling to enforce, and where it came from.
 *
 * - An explicit VALIDATION_MAX_RSS_BYTES wins; 0 turns the backstop off.
 * - Unset in a CDP environment, it is the task memory less the parse budget:
 *   the files already admitted can still be unpacking when the ceiling is
 *   crossed, and the parse budget is the most they can take. This follows the
 *   task size, so resizing a task cannot leave a stale ceiling behind.
 * - Unset locally, it is off: a developer machine has no task limit to protect.
 * @param {{ configured: number | null, deployed: boolean, taskMemory: number, parseBudget: number }} inputs
 * @returns {{ maxRssBytes: number, source: string }}
 */
export function resolveMaxRssBytes({
  configured,
  deployed,
  taskMemory,
  parseBudget
}) {
  if (configured !== null && configured !== undefined) {
    return {
      maxRssBytes: configured,
      source: configured
        ? 'VALIDATION_MAX_RSS_BYTES'
        : 'VALIDATION_MAX_RSS_BYTES=0'
    }
  }
  if (!deployed) {
    return { maxRssBytes: 0, source: 'local' }
  }
  const derived = taskMemory - parseBudget
  if (derived < MIN_DERIVED_CEILING_BYTES) {
    return {
      maxRssBytes: 0,
      source: `task memory ${taskMemory} less parse budget ${parseBudget} is too small to leave room above the warm baseline`
    }
  }
  return {
    maxRssBytes: derived,
    source: `task memory ${taskMemory} less parse budget ${parseBudget}`
  }
}

/**
 * The memory backstop. Deliberately separate from the parse budget: that one
 * counts the bytes it hands out and so can only see files being parsed, while
 * this reads the process's actual RSS — which is what the OOM-killer reads
 * too, and what measurement showed climbing to 1.2 GB from workers and
 * retained heap while the parse budget sat unexhausted.
 *
 * RSS is sampled every `sampleIntervalMs`. While the last sample is above
 * `maxRssBytes`, every request except /health is refused with the same 503
 * VALIDATION_BUSY answer the validate route gives when it is busy, so the
 * frontend keeps the user on its polling page and tries again. This replaces
 * Hapi's own `load.maxRssBytes`, which refuses /health as well and answers
 * with a body the frontend does not recognise as busy.
 *
 * Refusals are logged and counted once per sample interval, with the number
 * refused since the last sample.
 *
 * The ceiling comes from resolveMaxRssBytes, and the plugin logs it and its
 * source at boot. A CDP environment that ends up with it off logs a warning
 * instead, so a backstop that is not there does not go unnoticed.
 */
export const memoryShed = {
  plugin: {
    name: 'memory-shed',
    register(
      server,
      { maxRssBytes, source, sampleIntervalMs, retryAfterSeconds }
    ) {
      if (!maxRssBytes) {
        if (config.get('cdpEnvironment') !== 'local') {
          logger.warn(
            `Memory ceiling is off (${source}): under memory pressure the task will be killed at its memory limit instead of refusing new requests with a 503`
          )
        }
        return
      }
      logger.info(`Memory ceiling: ${maxRssBytes} bytes RSS (${source})`)

      let overLimit = false
      // Refusals are counted in memory and reported once per sample, not once
      // per request: a burst arrives exactly when the task is short of memory,
      // so the refuse path must not add a log line and an EMF flush each time.
      let refused = 0
      const reportRefused = () => {
        if (refused === 0) {
          return
        }
        const count = refused
        refused = 0
        logger.warn(
          `${count} request(s) refused as busy: RSS is above VALIDATION_MAX_RSS_BYTES (${maxRssBytes})`
        )
        // withMetrics catches and logs its own errors, so the promise is
        // deliberately not awaited. The catch is there so a future change to
        // that contract cannot turn a metric into an unhandled rejection.
        metricsCounter(GEOPACKAGE_METRIC.validationBusy, count, {
          reason: VALIDATION_BUSY_REASON.memoryRss
        }).catch(() => {})
      }
      const sample = () => {
        reportRefused()
        overLimit = process.memoryUsage.rss() > maxRssBytes
      }
      sample()
      const timer = setInterval(sample, sampleIntervalMs)
      timer.unref()
      server.events.on('stop', () => {
        clearInterval(timer)
        reportRefused()
      })

      server.ext('onRequest', (request, h) => {
        if (!overLimit || request.path === HEALTH_PATH) {
          return h.continue
        }
        refused++
        return h
          .response({
            valid: false,
            errors: [
              makeError(
                ERROR_CODES.VALIDATION_BUSY,
                'The service is busy checking other files. Please try again in a few moments.'
              )
            ]
          })
          .code(HTTP_STATUS.SERVICE_UNAVAILABLE)
          .header('Retry-After', String(retryAfterSeconds))
          .takeover()
      })
    }
  }
}

/**
 * The plugin's options, read from config and the task's memory.
 * @returns {{ maxRssBytes: number, source: string, sampleIntervalMs: number, retryAfterSeconds: number }}
 */
export function memoryShedOptionsFromConfig() {
  return {
    ...resolveMaxRssBytes({
      configured: config.get('validation.maxRssBytes'),
      deployed: config.get('cdpEnvironment') !== 'local',
      taskMemory: taskMemoryBytes(),
      parseBudget: config.get('validation.parseBudgetBytes')
    }),
    sampleIntervalMs: config.get('validation.loadSampleIntervalMs'),
    retryAfterSeconds: config.get('validation.busyRetryAfterSeconds')
  }
}
