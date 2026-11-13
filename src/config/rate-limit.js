import convict from 'convict'

/** Name of the format for a duration in milliseconds of at least a second. */
const AT_LEAST_ONE_SECOND_MS = 'at-least-one-second-ms'

const MIN_DURATION_MS = 1000

/**
 * A duration in whole milliseconds, at least a second. For the rate-limit
 * windows and their report interval, where 0 would be harmful rather than
 * off: a 0 window keeps no count, so the limit does nothing, and a 0 interval
 * reports on every turn of the event loop.
 */
convict.addFormat({
  name: AT_LEAST_ONE_SECOND_MS,
  coerce: Number,
  validate: (value) => {
    if (!Number.isInteger(value) || value < MIN_DURATION_MS) {
      throw new TypeError(
        `must be a whole number of milliseconds of at least ${MIN_DURATION_MS} (got "${value}")`
      )
    }
  }
})

/** Length of every rate-limit window unless an environment variable sets it. */
const ONE_MINUTE_MS = 60_000

/**
 * The three settings of one rate-limited route family (plugins/rate-limit.js):
 * a limit for each user, a limit for all users together, and the window both
 * count over. Each is read from its own environment variable, prefixed
 * `RATE_LIMIT_<FAMILY>_`.
 *
 * TODO(open point 2): the start values are estimates. The performance tests in
 * CDP (bng-perf-tests, the rate-limit profile) confirm or change them.
 * @param {{ what: string, envPrefix: string, userLimit: number, allUsersLimit: number }} family
 */
function rateLimitFamily({ what, envPrefix, userLimit, allUsersLimit }) {
  return {
    userLimit: {
      doc: `Requests one user may make to ${what} in one window, on one copy of the backend. The count is in memory, so a user can make this many on each copy.`,
      format: 'nat',
      default: userLimit,
      env: `${envPrefix}_USER_LIMIT`
    },
    allUsersLimit: {
      doc: `Requests all users together may make to ${what} in one window, on one copy of the backend.`,
      format: 'nat',
      default: allUsersLimit,
      env: `${envPrefix}_ALL_USERS_LIMIT`
    },
    windowMs: {
      doc: `Length of the window, in milliseconds, that the ${what} limits count over. The window starts at the first request and does not slide. At least 1000.`,
      format: AT_LEAST_ONE_SECOND_MS,
      default: ONE_MINUTE_MS,
      env: `${envPrefix}_WINDOW_MS`
    }
  }
}

/**
 * The `rateLimit` settings of config.js other than `enabled`: the report
 * interval and the limits of each route family.
 */
const rateLimitSettings = {
  reportIntervalMs: {
    doc: 'How often the refused requests counted since the last report are written as one log line and one metric for each route and type of limit (plugins/rate-limit.js). At least 1000.',
    format: AT_LEAST_ONE_SECOND_MS,
    default: ONE_MINUTE_MS,
    env: 'RATE_LIMIT_REPORT_INTERVAL_MS'
  },
  uploadInitiate: rateLimitFamily({
    what: 'POST /upload/initiate',
    envPrefix: 'RATE_LIMIT_UPLOAD_INITIATE',
    userLimit: 10,
    allUsersLimit: 60
  }),
  validate: rateLimitFamily({
    what: 'each validate route (baseline and post-intervention)',
    envPrefix: 'RATE_LIMIT_VALIDATE',
    userLimit: 40,
    allUsersLimit: 120
  }),
  report: rateLimitFamily({
    what: 'the PDF report route',
    envPrefix: 'RATE_LIMIT_REPORT',
    userLimit: 5,
    allUsersLimit: 20
  }),
  osTiles: rateLimitFamily({
    what: 'each /os-tiles route',
    envPrefix: 'RATE_LIMIT_OS_TILES',
    userLimit: 600,
    allUsersLimit: 3000
  })
}

export { rateLimitSettings }
