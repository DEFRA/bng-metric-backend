/**
 * The rate limits, in a real Hapi server with the real hapi-rate-limit. Only
 * the token check is faked: a stub strategy named like the real one takes the
 * user's `sub` from a header, so tests can send as any user.
 */

import Hapi from '@hapi/hapi'
import Boom from '@hapi/boom'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { config } from '../config.js'
import { metricsCounter } from '../common/helpers/metrics.js'
import {
  RATE_LIMIT_METRIC,
  RATE_LIMIT_TYPE
} from '../common/helpers/metric-names.js'
import { health } from '../routes/health.js'
import { router } from './router.js'
import {
  ALL_USERS_LIMIT_PLUGIN,
  RATE_LIMITED,
  RATE_LIMIT_PLUGIN,
  rateLimit,
  rateLimitRouteOptions,
  retryAfterSeconds,
  withRateLimit
} from './rate-limit.js'

const mockWarn = vi.hoisted(() => vi.fn())
const mockInfo = vi.hoisted(() => vi.fn())

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ warn: mockWarn, info: mockInfo, error: vi.fn() })
}))

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(() => Promise.resolve())
}))

const SUB_HEADER = 'x-test-sub'
const FIRST_USER = 'user-sub-1'
const SECOND_USER = 'user-sub-2'
const WINDOW_MS = 60_000
const WINDOW_SECONDS = 60
const START = new Date('2026-11-12T10:00:00Z')
const HTTP_OK = 200
const HTTP_TOO_MANY_REQUESTS = 429
const UNLIMITED_REQUESTS = 100

// The routes the ticket limits, with their default limits for each user and
// for all users. The url varies its ids so the tests show that the count is
// by route, not by path.
const LIMITED_ROUTES = [
  {
    name: 'the upload start',
    method: 'POST',
    path: '/upload/initiate',
    url: () => '/upload/initiate',
    family: RATE_LIMITED.uploadInitiate,
    userLimit: 10,
    allUsersLimit: 60
  },
  {
    name: 'baseline validation',
    method: 'POST',
    path: '/baseline/validate/{uploadId}',
    url: (n) => `/baseline/validate/upload-${n}`,
    family: RATE_LIMITED.validate,
    userLimit: 40,
    allUsersLimit: 120
  },
  {
    name: 'post-intervention validation',
    method: 'POST',
    path: '/post-intervention/validate/{uploadId}',
    url: (n) => `/post-intervention/validate/upload-${n}`,
    family: RATE_LIMITED.validate,
    userLimit: 40,
    allUsersLimit: 120
  },
  {
    name: 'the PDF report',
    method: 'GET',
    path: '/projects/{projectId}/report.pdf',
    url: (n) => `/projects/project-${n}/report.pdf`,
    family: RATE_LIMITED.report,
    userLimit: 5,
    allUsersLimit: 20
  },
  {
    name: 'an OS map tile',
    method: 'GET',
    path: '/os-tiles/{z}/{col}/{row}.png',
    url: (n) => `/os-tiles/3/${n}/4.png`,
    family: RATE_LIMITED.osTiles,
    userLimit: 600,
    allUsersLimit: 3000
  }
]

function stubConfig(overrides) {
  const get = config.get.bind(config)
  vi.spyOn(config, 'get').mockImplementation((key) =>
    key in overrides ? overrides[key] : get(key)
  )
}

/** A strategy that trusts a header for `sub`, registered as 'defra-jwt'. */
function registerStubAuth(server) {
  server.auth.scheme('stub-jwt', () => ({
    authenticate: (request, h) => {
      const sub = request.headers[SUB_HEADER]
      return sub
        ? h.authenticated({ credentials: { sub } })
        : h.unauthenticated(Boom.unauthorized())
    }
  }))
  server.auth.strategy('defra-jwt', 'stub-jwt')
  server.auth.default('defra-jwt')
}

let server

/**
 * A server with the rate limits, /health, `routes` as they are and `limited`
 * with their limits on. The limited routes are built after config is stubbed,
 * because a route reads its limits when it is built.
 */
async function serverWith({
  limited = [],
  routes = [],
  configOverrides = {}
} = {}) {
  stubConfig(configOverrides)
  server = Hapi.server()
  registerStubAuth(server)
  await server.register(rateLimit)
  server.route([health, ...routes, ...limited.map(limitedRoute)])
  await server.initialize()
  return server
}

function limitedRoute({ method, path, family }) {
  return withRateLimit({ method, path, handler: () => 'ok' }, family)
}

function send(route, sub, n = 0) {
  return server.inject({
    method: route.method,
    url: route.url(n),
    headers: { [SUB_HEADER]: sub }
  })
}

async function sendMany(route, sub, count) {
  const statuses = []
  for (let n = 0; n < count; n++) {
    statuses.push((await send(route, sub, n)).statusCode)
  }
  return statuses
}

afterEach(async () => {
  await server?.stop()
  server = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('#retryAfterSeconds', () => {
  test('is the whole seconds until the reset, rounded up', () => {
    expect(retryAfterSeconds(10_500, WINDOW_MS, 1_000)).toBe(10)
    expect(retryAfterSeconds(10_001, WINDOW_MS, 1_000)).toBe(10)
  })

  test('is the window when the plugin gives no reset time', () => {
    expect(retryAfterSeconds(undefined, WINDOW_MS, 1_000)).toBe(WINDOW_SECONDS)
  })

  test('is never less than 1 second', () => {
    expect(retryAfterSeconds(1_000, WINDOW_MS, 1_000)).toBe(1)
    expect(retryAfterSeconds(500, WINDOW_MS, 1_000)).toBe(1)
  })
})

describe('#rateLimitRouteOptions', () => {
  test.each(LIMITED_ROUTES)(
    'turns on the default limits for $name',
    ({ family, userLimit, allUsersLimit }) => {
      expect(rateLimitRouteOptions(family)).toEqual({
        [RATE_LIMIT_PLUGIN]: {
          enabled: true,
          ignorePathParams: true,
          userPathLimit: userLimit,
          userPathCache: { expiresIn: WINDOW_MS }
        },
        [ALL_USERS_LIMIT_PLUGIN]: {
          enabled: true,
          limit: allUsersLimit,
          windowMs: WINDOW_MS
        }
      })
    }
  )

  test('reads each limit and window from config', () => {
    stubConfig({
      'rateLimit.report.userLimit': 2,
      'rateLimit.report.allUsersLimit': 3,
      'rateLimit.report.windowMs': 1_000
    })

    expect(rateLimitRouteOptions(RATE_LIMITED.report)).toMatchObject({
      [RATE_LIMIT_PLUGIN]: {
        userPathLimit: 2,
        userPathCache: { expiresIn: 1_000 }
      },
      [ALL_USERS_LIMIT_PLUGIN]: { limit: 3, windowMs: 1_000 }
    })
  })

  test('keeps the route options it is given', () => {
    const route = withRateLimit(
      {
        method: 'GET',
        path: '/x',
        options: { auth: false, plugins: { other: { a: 1 } } },
        handler: () => 'ok'
      },
      RATE_LIMITED.report
    )

    expect(route.options.auth).toBe(false)
    expect(route.options.plugins.other).toEqual({ a: 1 })
    expect(route.options.plugins[RATE_LIMIT_PLUGIN].enabled).toBe(true)
  })
})

describe.each(LIMITED_ROUTES)('rate limit on $name', (route) => {
  async function start() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    return serverWith({ limited: [route] })
  }

  test('allows each user up to the limit', async () => {
    await start()

    const statuses = await sendMany(route, FIRST_USER, route.userLimit)

    expect(statuses.every((status) => status === HTTP_OK)).toBe(true)
  })

  test('refuses the next request from that user with 429 and Retry-After', async () => {
    await start()
    await sendMany(route, FIRST_USER, route.userLimit)

    const response = await send(route, FIRST_USER)

    expect(response.statusCode).toBe(HTTP_TOO_MANY_REQUESTS)
    expect(response.headers['retry-after']).toBe(String(WINDOW_SECONDS))
  })

  test('gives the time left in the window as Retry-After', async () => {
    await start()
    await sendMany(route, FIRST_USER, route.userLimit)
    vi.setSystemTime(START.getTime() + 45_000)

    const response = await send(route, FIRST_USER)

    expect(response.statusCode).toBe(HTTP_TOO_MANY_REQUESTS)
    expect(response.headers['retry-after']).toBe('15')
  })

  test('allows the user again once the window has passed', async () => {
    await start()
    await sendMany(route, FIRST_USER, route.userLimit + 1)
    vi.setSystemTime(START.getTime() + WINDOW_MS + 1)

    const response = await send(route, FIRST_USER)

    expect(response.statusCode).toBe(HTTP_OK)
  })

  test('still allows a second user when the first is over the limit', async () => {
    await start()
    await sendMany(route, FIRST_USER, route.userLimit + 1)

    const response = await send(route, SECOND_USER)

    expect(response.statusCode).toBe(HTTP_OK)
  })

  test("does not count a user's refused requests toward the all-users limit", async () => {
    await start()
    // One user keeps sending well past the all-users limit. Only the requests
    // their own limit let through count for everybody.
    await sendMany(route, FIRST_USER, route.allUsersLimit + route.userLimit)

    const response = await send(route, SECOND_USER)

    expect(response.statusCode).toBe(HTTP_OK)
  })

  test('refuses a new user once all users together reach the limit', async () => {
    await start()
    const users = Math.ceil(route.allUsersLimit / route.userLimit)
    for (let u = 0; u < users; u++) {
      const share = Math.min(
        route.userLimit,
        route.allUsersLimit - u * route.userLimit
      )
      await sendMany(route, `sub-${u}`, share)
    }

    const response = await send(route, 'a-new-user')

    expect(response.statusCode).toBe(HTTP_TOO_MANY_REQUESTS)
    expect(response.headers['retry-after']).toBe(String(WINDOW_SECONDS))
  })
})

describe('the wait when both limits are full', () => {
  test('is the later of the two resets, so a retry is not refused again', async () => {
    const report = LIMITED_ROUTES.find((r) => r.family === RATE_LIMITED.report)
    const at = (seconds) => vi.setSystemTime(START.getTime() + seconds * 1000)
    vi.useFakeTimers({ toFake: ['Date'] })
    await serverWith({ limited: [report] })

    // 0 s: another user opens an all-users window, to 60 s.
    at(0)
    await sendMany(report, 'early-user', 1)
    // 30 s: the first user uses their whole limit; their window runs to 90 s.
    at(30)
    await sendMany(report, FIRST_USER, report.userLimit)
    // 61 s: that all-users window has ended. Others open a new one, to 121 s,
    // and fill it.
    at(61)
    for (let u = 0; u < report.allUsersLimit / report.userLimit; u++) {
      await sendMany(report, `sub-${u}`, report.userLimit)
    }
    // 70 s: the first user is over their own limit (resets at 90 s) and the
    // all-users limit is full (resets at 121 s).
    at(70)

    const response = await send(report, FIRST_USER)

    expect(response.statusCode).toBe(HTTP_TOO_MANY_REQUESTS)
    expect(response.headers['retry-after']).toBe('51')
  })
})

describe('routes with no limit', () => {
  const unlimited = {
    method: 'GET',
    path: '/upload/{uploadId}/status',
    url: (n) => `/upload/upload-${n}/status`
  }

  test('a route with no limit never gets a 429', async () => {
    await serverWith({
      routes: [
        { method: unlimited.method, path: unlimited.path, handler: () => 'ok' }
      ]
    })

    const statuses = await sendMany(unlimited, FIRST_USER, UNLIMITED_REQUESTS)

    expect(statuses.every((status) => status === HTTP_OK)).toBe(true)
  })

  test('/health never gets a 429, even with every limited route over its limit', async () => {
    const report = LIMITED_ROUTES.find((r) => r.family === RATE_LIMITED.report)
    await serverWith({ limited: [report] })
    await sendMany(report, FIRST_USER, report.allUsersLimit + 1)

    const statuses = []
    for (let n = 0; n < UNLIMITED_REQUESTS; n++) {
      statuses.push((await server.inject('/health')).statusCode)
    }

    expect(statuses.every((status) => status === HTTP_OK)).toBe(true)
  })

  test('RATE_LIMIT_ENABLED=false turns every limit off', async () => {
    const upload = LIMITED_ROUTES[0]
    await serverWith({
      limited: [upload],
      configOverrides: { 'rateLimit.enabled': false }
    })

    const statuses = await sendMany(upload, FIRST_USER, upload.userLimit + 1)

    expect(statuses.every((status) => status === HTTP_OK)).toBe(true)
    expect(mockInfo).toHaveBeenCalledWith(
      'Rate limits are off (RATE_LIMIT_ENABLED=false)'
    )
  })
})

describe('the router', () => {
  test('turns the limits on for the limited routes, and only for them', async () => {
    stubConfig({ 'osMaps.apiKey': '', useSwagger: false })
    server = Hapi.server()
    registerStubAuth(server)
    await server.register(router)

    const limited = server
      .table()
      .filter((route) => route.settings.plugins[RATE_LIMIT_PLUGIN])
      .map((route) => `${route.method.toUpperCase()} ${route.path}`)
      .sort((a, b) => a.localeCompare(b))

    expect(limited).toEqual([
      'GET /projects/{projectId}/report.pdf',
      'POST /baseline/validate/{uploadId}',
      'POST /post-intervention/validate/{uploadId}',
      'POST /upload/initiate'
    ])
  })
})

describe('the refused-request report', () => {
  const report = LIMITED_ROUTES.find((r) => r.family === RATE_LIMITED.report)

  test('writes 1 log line and 1 metric for each route and type of limit', async () => {
    await serverWith({ limited: [report] })
    await sendMany(report, FIRST_USER, report.userLimit + 3)

    await server.stop()

    expect(mockWarn).toHaveBeenCalledTimes(1)
    const [line] = mockWarn.mock.calls[0]
    expect(line).toContain('3 request(s)')
    expect(line).toContain(report.path)
    expect(line).toContain(`the ${RATE_LIMIT_TYPE.user} rate limit`)
    expect(line).not.toContain(FIRST_USER)
    expect(line).not.toContain('project-')
    expect(metricsCounter).toHaveBeenCalledTimes(1)
    expect(metricsCounter).toHaveBeenCalledWith(
      RATE_LIMIT_METRIC.requestsRefused,
      3,
      { route: report.path, limit: RATE_LIMIT_TYPE.user }
    )
  })

  test('names the all-users limit when that one refused', async () => {
    await serverWith({ limited: [report] })
    for (let u = 0; u < report.allUsersLimit / report.userLimit; u++) {
      await sendMany(report, `sub-${u}`, report.userLimit)
    }
    await send(report, 'a-new-user')
    await send(report, 'another-new-user')

    await server.stop()

    expect(metricsCounter).toHaveBeenCalledWith(
      RATE_LIMIT_METRIC.requestsRefused,
      2,
      { route: report.path, limit: RATE_LIMIT_TYPE.allUsers }
    )
  })

  test('reports each interval, and only what was refused in it', async () => {
    await serverWith({
      limited: [report],
      configOverrides: { 'rateLimit.reportIntervalMs': 20 }
    })
    await sendMany(report, FIRST_USER, report.userLimit + 2)

    await vi.waitFor(() => expect(mockWarn).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][0]).toContain('2 request(s)')
  })

  test('writes nothing when nothing was refused', async () => {
    await serverWith({ limited: [report] })
    await sendMany(report, FIRST_USER, report.userLimit)

    await server.stop()

    expect(mockWarn).not.toHaveBeenCalled()
    expect(metricsCounter).not.toHaveBeenCalled()
  })
})
