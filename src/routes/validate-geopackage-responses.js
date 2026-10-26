import {
  ValidationQueueFullError,
  ValidationQueueWaitError,
  ValidationTimeoutError
} from '../validation/geopackage/geos/worker-pool.js'
import { ParseBudgetExceededError } from '../validation/geopackage/parse-budget.js'
import { ERROR_CODES, makeError } from '../validation/geopackage/errors.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { metricsCounter } from '../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_BUSY_REASON
} from '../common/helpers/metric-names.js'
import { config as appConfig } from '../config.js'

/**
 * The validate routes' answers for a file refused for want of capacity rather
 * than merit: busy, which asks the caller to retry, and unavailable, which
 * tells it not to.
 */

const logger = createLogger()

/**
 * Every way a file can be refused for want of capacity rather than merit.
 *
 * All but one of these are decided before the file is looked at. The exception
 * is a worker timeout, and it only belongs here SOMETIMES — which is the whole
 * subtlety of this function.
 *
 * A burst is the case it was added for. With one worker and a slow file, the
 * requests behind the first are refused `queue_wait` before they start, retry,
 * and pass; the one that actually reached a worker was killed mid-job and, as a
 * 500, was the only one in the burst that could not recover. Same capacity
 * problem, opposite outcome, purely because of where in the pipeline it was
 * discovered.
 *
 * But a timeout on an EMPTY pool is a different animal. The file had the box to
 * itself and still could not be validated inside the budget, so a retry only
 * reproduces the failure — and, because `Retry-After` is shorter than the budget
 * it just overran, it would do so repeatedly: every attempt burns a full budget
 * of worker time and costs a worker restart, for the two minutes the frontend
 * keeps trying. That is the "pathological file re-fed to the pool" the design
 * note in docs/geometry-validation.md warns about, and it is why a timeout is
 * not simply reclassified as busy.
 *
 * `contended` is what tells them apart, and the pool records it at the moment
 * the timer fires. Retry only what a retry could plausibly fix.
 */
export function busyReason(error) {
  if (error instanceof ValidationQueueFullError) {
    return VALIDATION_BUSY_REASON.queueFull
  }
  if (error instanceof ValidationQueueWaitError) {
    return VALIDATION_BUSY_REASON.queueWait
  }
  if (error instanceof ValidationTimeoutError && error.contended) {
    return VALIDATION_BUSY_REASON.workerTimeout
  }
  if (error instanceof ParseBudgetExceededError) {
    return VALIDATION_BUSY_REASON.memoryBudget
  }
  return null
}

/**
 * Every validation worker was busy and the queue was full, so the file was
 * never looked at.
 *
 * This is the one rejection that is NOT about the user's file, and it is
 * answered differently on purpose. A 503 with Retry-After says "come back",
 * which is both true and actionable; returning the usual 200-with-errors would
 * put a capacity problem on the same screen as "your polygons overlap" and
 * invite the user to go and edit a file that is perfectly fine.
 */
export async function respondToBusy(uploadId, h, config, reason) {
  logger.warn(
    `${config.routeName} - validation refused as busy (${reason}) for uploadId ${uploadId}; asked the caller to retry`
  )
  await metricsCounter(GEOPACKAGE_METRIC.validationBusy, 1, { reason })
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
    .header(
      'Retry-After',
      String(appConfig.get('validation.busyRetryAfterSeconds'))
    )
}

/**
 * The pool has permanently given up — its workers cannot start — so this is
 * `respondToBusy`'s opposite in everything but the status code. Busy means the
 * next attempt may well pass; here every retry meets the same wall until an
 * operator restarts the service. Hence no Retry-After, and a code that is
 * deliberately NOT VALIDATION_BUSY: the frontend re-polls only on that exact
 * code, so this answer drops the caller out of its polling loop and onto an
 * honest error page instead of two minutes of pointless refreshing.
 */
export async function respondToUnavailable(uploadId, h, config) {
  logger.error(
    `${config.routeName} - validation unavailable (worker pool has given up) for uploadId ${uploadId}; told the caller not to retry`
  )
  await metricsCounter(GEOPACKAGE_METRIC.validationUnavailable)
  return h
    .response({
      valid: false,
      errors: [
        makeError(
          ERROR_CODES.VALIDATION_UNAVAILABLE,
          'The file checking service is currently unavailable. Please try again later.'
        )
      ]
    })
    .code(HTTP_STATUS.SERVICE_UNAVAILABLE)
}
