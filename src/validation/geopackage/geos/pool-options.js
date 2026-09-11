/**
 * Every validation-pool setting, read from config in ONE place.
 *
 * The pool is a process-wide singleton built on first use, so the first caller
 * to ask for it decides how every later one gets it. That made a divergence
 * between the two call sites — the validate route and `validation/geopackage/
 * index.js` — invisible: they passed different option sets, whichever ran first
 * silently won, and a process that reached the shorter list first ran with no
 * queue-wait limit and no admission limit at all. Nothing failed. The two
 * controls simply were not there.
 *
 * It lives in its own module rather than alongside `validateGeoPackageLayers`
 * because it is configuration, not validation: route tests mock the validation
 * module wholesale, and a config helper hiding inside it would have to be
 * re-stubbed by every one of them.
 */
import { config } from '../../../config.js'

/**
 * @returns {import('./worker-pool.js').PoolOptions} the full option set, so
 *   neither call site can carry a partial one.
 */
export function validationPoolOptions() {
  return {
    size: config.get('validation.workerCount'),
    queueLimit: config.get('validation.workerQueueLimit'),
    timeoutMs: config.get('validation.workerTimeoutMs'),
    queueWaitLimitMs: config.get('validation.queueWaitLimitMs'),
    admissionLimit: config.get('validation.admissionLimit')
  }
}
