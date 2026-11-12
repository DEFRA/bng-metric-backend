/**
 * Rate limits on the routes that cost the most to serve, with hapi-rate-limit.
 *
 * CDP's Nginx allows 1000 requests a second, which the costly routes cannot
 * carry: the upload start, the two validate routes, the PDF report and the OS
 * tiles (which also spend the OS API quota). Each of those gets two limits —
 * one for each user and one for all users together — and every other route
 * gets none, because the CDP limit protects them.
 *
 * Every plugin default is off at server level, so a route is limited only when
 * it opts in through `withRateLimit`:
 *   - `authLimit: false`. Every request comes from the frontend, so the
 *     plugin's count of bad tokens per IP address would block it for all users.
 *   - `trustProxy: false`. The user is the token's `sub` claim
 *     (`userAttribute`), never an IP address.
 *
 * Where it sits among the load controls: memory-shed refuses in `onRequest`,
 * before authentication. These limits are checked in `onPostAuth`, after it
 * and before the handler, so they come before the validate route's admission
 * limit, parse budget and worker queue. They do not replace any of them.
 *
 * What to know about the counts:
 *   - They live in the default server cache, in memory, so each copy of the
 *     backend counts on its own. A user can make the user limit on each copy.
 *   - A window starts at the first request and does not slide.
 *   - The plugin counts refused requests too, and counts a user's requests
 *     toward the all-users limit even when that user is over their own.
 *
 * Refused requests are counted here and reported once each interval, as
 * memory-shed does: one log line and one metric for each route and type of
 * limit. Nothing that identifies the user is recorded.
 */
import Boom from '@hapi/boom'
import hapiRateLimit from 'hapi-rate-limit'

import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { metricsCounter } from '../common/helpers/metrics.js'
import {
  RATE_LIMIT_METRIC,
  RATE_LIMIT_TYPE
} from '../common/helpers/metric-names.js'

const logger = createLogger()

/** hapi-rate-limit's name: the key of its route settings and request state. */
export const RATE_LIMIT_PLUGIN = 'hapi-rate-limit'

/** The route families with a limit, each a section of `rateLimit` in config. */
export const RATE_LIMITED = Object.freeze({
  uploadInitiate: 'uploadInitiate',
  validate: 'validate',
  report: 'report',
  osTiles: 'osTiles'
})

const MS_PER_SECOND = 1000
const MIN_RETRY_AFTER_SECONDS = 1

/**
 * The route settings that turn the limits on for one route family, read from
 * config when the route is registered.
 *
 * `ignorePathParams` counts the route's pattern rather than its path, so
 * `/baseline/validate/{uploadId}` is one count, not one per upload. Each
 * window goes in as the TTL of its cache entries, which is how the plugin
 * times a window.
 * @param {string} family - one of {@link RATE_LIMITED}
 */
export function rateLimitRouteOptions(family) {
  const windowMs = config.get(`rateLimit.${family}.windowMs`)
  return {
    [RATE_LIMIT_PLUGIN]: {
      enabled: config.get('rateLimit.enabled'),
      ignorePathParams: true,
      userPathLimit: config.get(`rateLimit.${family}.userLimit`),
      pathLimit: config.get(`rateLimit.${family}.allUsersLimit`),
      userPathCache: { expiresIn: windowMs },
      pathCache: { expiresIn: windowMs }
    }
  }
}

/**
 * A copy of a route definition with the limits of `family` turned on.
 * @param {import('@hapi/hapi').ServerRoute} route
 * @param {string} family - one of {@link RATE_LIMITED}
 */
export function withRateLimit(route, family) {
  return {
    ...route,
    options: {
      ...route.options,
      plugins: {
        ...route.options?.plugins,
        ...rateLimitRouteOptions(family)
      }
    }
  }
}

/**
 * Seconds until the limit that refused the request resets: the plugin's reset
 * time when it has one, otherwise the whole window. Never less than 1, because
 * `Retry-After: 0` would invite an immediate retry into the same refusal.
 * @param {number | undefined} resetAt - epoch milliseconds
 * @param {number} windowMs
 * @param {number} now - epoch milliseconds
 */
export function retryAfterSeconds(resetAt, windowMs, now) {
  const waitMs = Number.isFinite(resetAt) ? resetAt - now : windowMs
  return Math.max(MIN_RETRY_AFTER_SECONDS, Math.ceil(waitMs / MS_PER_SECOND))
}

/**
 * Which limit refused the request, its reset time and its window, from the
 * state the plugin leaves on the request. The user limit wins when both are
 * over, because that user is the cause either way.
 * @param {object} state - `request.plugins['hapi-rate-limit']`
 */
function refusingLimit(state) {
  if (state.userPathRemaining < 0) {
    return {
      type: RATE_LIMIT_TYPE.user,
      resetAt: state.userPathReset,
      windowMs: state.settings?.userPathCache?.expiresIn
    }
  }
  return {
    type: RATE_LIMIT_TYPE.allUsers,
    resetAt: state.pathReset,
    windowMs: state.settings?.pathCache?.expiresIn
  }
}

/** Counts refused requests by route and type of limit between two reports. */
function createRefusalCounter() {
  const counts = new Map()
  return {
    add(route, limit) {
      const key = `${limit} ${route}`
      const entry = counts.get(key) ?? { route, limit, count: 0 }
      entry.count++
      counts.set(key, entry)
    },
    drain() {
      const entries = [...counts.values()]
      counts.clear()
      return entries
    }
  }
}

/**
 * One log line and one metric for each route and type of limit that refused
 * something since the last report. The route is its pattern, so no id from a
 * path, and no `sub`, reaches either.
 */
function report(counter, intervalMs) {
  for (const { route, limit, count } of counter.drain()) {
    logger.warn(
      `${count} request(s) to ${route} refused by the ${limit} rate limit in the last ${intervalMs} ms`
    )
    // withMetrics catches and logs its own errors, so the promise is not
    // awaited; the catch keeps a change to that contract from becoming an
    // unhandled rejection.
    metricsCounter(RATE_LIMIT_METRIC.requestsRefused, count, {
      route,
      limit
    }).catch(() => {})
  }
}

/**
 * The plugin's server options: every default off, the user from `sub`, and
 * the refusal below.
 * @param {ReturnType<typeof createRefusalCounter>} counter
 */
function serverOptions(counter) {
  return {
    enabled: false,
    userLimit: false,
    pathLimit: false,
    userPathLimit: false,
    authLimit: false,
    trustProxy: false,
    userAttribute: 'sub',
    limitExceededResponse: (request) => {
      const state = request.plugins[RATE_LIMIT_PLUGIN] ?? {}
      const { type, resetAt, windowMs } = refusingLimit(state)
      counter.add(request.route.path, type)
      const error = Boom.tooManyRequests('Too many requests')
      error.output.headers['Retry-After'] = String(
        retryAfterSeconds(resetAt, windowMs, Date.now())
      )
      return error
    }
  }
}

export const rateLimit = {
  plugin: {
    name: 'rate-limit',
    async register(server) {
      const enabled = config.get('rateLimit.enabled')
      logger.info(
        enabled
          ? 'Rate limits are on for the upload start, validation, the PDF report and the OS tiles'
          : 'Rate limits are off (RATE_LIMIT_ENABLED=false)'
      )

      const counter = createRefusalCounter()
      await server.register({
        plugin: hapiRateLimit,
        options: serverOptions(counter)
      })

      const intervalMs = config.get('rateLimit.reportIntervalMs')
      const timer = setInterval(() => report(counter, intervalMs), intervalMs)
      timer.unref()
      server.events.on('stop', () => {
        clearInterval(timer)
        report(counter, intervalMs)
      })
    }
  }
}
