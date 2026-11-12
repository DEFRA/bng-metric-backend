/**
 * Rate limits on the routes that cost the most to serve, with hapi-rate-limit.
 *
 * CDP's Nginx allows 1000 requests a second, which the costly routes cannot
 * carry: the upload start, the two validate routes, the PDF report and the OS
 * tiles (which also spend the OS API quota). Each of those gets two limits —
 * one for each user and one for all users together — and every other route
 * gets none, because the CDP limit protects them.
 *
 * The limit for each user is hapi-rate-limit's `userPathLimit`. The limit for
 * all users is NOT the plugin's `pathLimit`, on purpose: the plugin counts
 * every request toward `pathLimit`, including the ones the user limit has
 * already refused, so one user who kept sending would use up the all-users
 * limit for everybody at almost no cost to themselves. The all-users limit is
 * therefore counted here, in an `onPostAuth` step that runs after the
 * plugin's, so it only ever sees requests the user limit let through.
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
 *   - They are in memory (the user counts in the default server cache), so
 *     each copy of the backend counts on its own. A user can make the user
 *     limit on each copy.
 *   - A window starts at the first request and does not slide.
 *   - The plugin counts a user's refused requests toward that user's own
 *     limit, which costs only that user.
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
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import {
  RATE_LIMIT_METRIC,
  RATE_LIMIT_TYPE
} from '../common/helpers/metric-names.js'

const logger = createLogger()

/** hapi-rate-limit's name: the key of its route settings and request state. */
export const RATE_LIMIT_PLUGIN = 'hapi-rate-limit'

/** This plugin's name, and the key of the all-users settings on a route. */
export const ALL_USERS_LIMIT_PLUGIN = 'rate-limit'

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
 * config when the route is registered: the limit for each user under
 * hapi-rate-limit's key, and the limit for all users under this plugin's.
 *
 * `ignorePathParams` counts the route's pattern rather than its path, so
 * `/baseline/validate/{uploadId}` is one count, not one per upload. The
 * window goes in as the TTL of the plugin's cache entries, which is how it
 * times a window.
 * @param {string} family - one of {@link RATE_LIMITED}
 */
export function rateLimitRouteOptions(family) {
  const enabled = config.get('rateLimit.enabled')
  const windowMs = config.get(`rateLimit.${family}.windowMs`)
  return {
    [RATE_LIMIT_PLUGIN]: {
      enabled,
      ignorePathParams: true,
      userPathLimit: config.get(`rateLimit.${family}.userLimit`),
      userPathCache: { expiresIn: windowMs }
    },
    [ALL_USERS_LIMIT_PLUGIN]: {
      enabled,
      limit: config.get(`rateLimit.${family}.allUsersLimit`),
      windowMs
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
 * The all-users count of each limited route: a fixed window from the route's
 * first counted request. Only requests the user limit let through reach it.
 */
function createAllUsersCounter() {
  const windows = new Map()
  const current = (route, now) => {
    const window = windows.get(route)
    return window && window.resetAt > now ? window : null
  }
  return {
    /**
     * Count one request. Null when it is admitted; the time the window resets
     * when the route is already at its limit (the request is not counted).
     */
    admit(route, { limit, windowMs }, now) {
      let window = current(route, now)
      if (!window) {
        window = { count: 0, resetAt: now + windowMs }
        windows.set(route, window)
      }
      if (window.count >= limit) {
        return window.resetAt
      }
      window.count++
      return null
    },
    /** When the route's all-users limit is full, the time it resets; else null. */
    fullUntil(route, limit, now) {
      const window = current(route, now)
      return window && window.count >= limit ? window.resetAt : null
    },
    /** The time the route's current window resets, or null when it has none. */
    windowResetAt(route, now) {
      return current(route, now)?.resetAt ?? null
    },
    /**
     * Give back one counted request, when the window it was counted in is
     * still the current one. A later window never pays for an earlier one.
     */
    refund(route, resetAt, now) {
      const window = current(route, now)
      if (window?.resetAt === resetAt && window.count > 0) {
        window.count--
      }
    }
  }
}

/** A 429 with the seconds to wait in Retry-After. */
function tooManyRequests(seconds) {
  const error = Boom.tooManyRequests('Too many requests')
  error.output.headers['Retry-After'] = String(seconds)
  return error
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
 * the refusal below. Only the user limit is the plugin's, so it only ever
 * refuses as `user`.
 *
 * The wait is the user window's reset, or the all-users window's when that is
 * also full and resets later: a retry at the user reset alone would only be
 * refused again by the all-users limit.
 * @param {ReturnType<typeof createRefusalCounter>} refusals
 * @param {ReturnType<typeof createAllUsersCounter>} allUsers
 */
function serverOptions(refusals, allUsers) {
  return {
    enabled: false,
    userLimit: false,
    pathLimit: false,
    userPathLimit: false,
    authLimit: false,
    trustProxy: false,
    userAttribute: 'sub',
    limitExceededResponse: (request) => {
      const now = Date.now()
      const state = request.plugins[RATE_LIMIT_PLUGIN] ?? {}
      const allUsersSettings =
        request.route.settings.plugins[ALL_USERS_LIMIT_PLUGIN]
      const allUsersReset = allUsersSettings
        ? allUsers.fullUntil(request.route.path, allUsersSettings.limit, now)
        : null
      const resetAt = Math.max(state.userPathReset ?? 0, allUsersReset ?? 0)
      refusals.add(request.route.path, RATE_LIMIT_TYPE.user)
      return tooManyRequests(
        retryAfterSeconds(
          resetAt || undefined,
          state.settings?.userPathCache?.expiresIn,
          now
        )
      )
    }
  }
}

/**
 * The all-users limit, after the plugin's user limit has let the request
 * through.
 */
function allUsersLimitStep(refusals, allUsers) {
  return (request, h) => {
    const settings = request.route.settings.plugins[ALL_USERS_LIMIT_PLUGIN]
    if (!settings?.enabled) {
      return h.continue
    }
    const now = Date.now()
    const resetAt = allUsers.admit(request.route.path, settings, now)
    if (resetAt === null) {
      // Remembered so a busy answer can give the request back (below).
      request.plugins[ALL_USERS_LIMIT_PLUGIN] = {
        windowResetAt: allUsers.windowResetAt(request.route.path, now)
      }
      return h.continue
    }
    refusals.add(request.route.path, RATE_LIMIT_TYPE.allUsers)
    return tooManyRequests(retryAfterSeconds(resetAt, settings.windowMs, now))
  }
}

/**
 * A request the route answered 503 did no work: the validate routes refuse
 * as busy (VALIDATION_BUSY) or unavailable before they fetch the file. So it
 * gives back its place in the all-users count. Without this, users in the
 * frontend's busy-and-retry journey, each retrying every 5 to 8 seconds, would
 * use up the all-users limit with retries that cost nothing, and then be sent
 * a 429 exactly when the service is recovering.
 *
 * The limit for each user still counts the retry; at about 13 a minute that
 * stays well under it.
 */
function refundBusyStep(allUsers) {
  return (request, h) => {
    const counted = request.plugins[ALL_USERS_LIMIT_PLUGIN]
    if (!counted) {
      return h.continue
    }
    const { response } = request
    const status = response.isBoom
      ? response.output.statusCode
      : response.statusCode
    if (status === HTTP_STATUS.SERVICE_UNAVAILABLE) {
      allUsers.refund(request.route.path, counted.windowResetAt, Date.now())
    }
    return h.continue
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
      const allUsers = createAllUsersCounter()
      await server.register({
        plugin: hapiRateLimit,
        options: serverOptions(counter, allUsers)
      })
      // After the plugin's own onPostAuth step, so a request the user limit
      // refused never reaches the all-users count.
      server.ext('onPostAuth', allUsersLimitStep(counter, allUsers), {
        after: [RATE_LIMIT_PLUGIN]
      })
      server.ext('onPreResponse', refundBusyStep(allUsers))

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
