import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, stopServer } from './helpers/server.js'
import { mintToken, buildAuthHeaders } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401

// Secure-by-default policy (see docs/auth-route-policy.md): the server sets
// 'defra-jwt' as the default auth strategy (server.auth.default in
// src/server.js), so EVERY route requires a verified bearer token unless it
// explicitly opts out with `auth: false`. A new endpoint added without any auth
// config inherits the default and is protected automatically — forgetting auth
// fails closed, not open.
//
// Note on Hapi internals: the default is applied at REQUEST time, not stamped
// onto each route. So a route relying on the default has `settings.auth ===
// undefined` in the route table (yet is protected at runtime), an explicitly
// protected route has an auth object, and a public route has `settings.auth ===
// false`. This guard accounts for all three and proves the default actually
// enforces with a live request.
//
// To make a route public you must do BOTH: set `auth: false` on the route AND
// add it here with a justification — so every public surface is a reviewed,
// deliberate decision.
const PUBLIC_ROUTES = new Map([
  ['get /health', 'CDP liveness/readiness probe — must be unauthenticated'],
  [
    'get /db-info',
    'Local/dev DB-version diagnostic (never registered in prod)'
  ],
  [
    'get /reference/broad-habitats',
    'Static reference data — no per-user scope'
  ],
  ['get /reference/habitat-types', 'Static reference data — no per-user scope'],
  [
    'get /reference/habitat-types-by-broad',
    'Static reference data — no per-user scope'
  ],
  ['get /reference/conditions', 'Static reference data — no per-user scope'],
  [
    'get /reference/hedgerow-types',
    'Static reference data — no per-user scope'
  ],
  [
    'get /reference/watercourse-types',
    'Static reference data — no per-user scope'
  ],
  [
    'get /reference/watercourse-encroachments',
    'Static reference data — no per-user scope'
  ],
  ['get /reference/trading-rules', 'Static reference data — no per-user scope']
])

let server
let token

beforeAll(async () => {
  server = await startServer()
  // startServer() runs initTestJwks(), so a minted token plus matching HMAC
  // headers (see buildAuthHeaders) authenticates against the shared secret. Used
  // to prove the default ACCEPTS a valid token.
  token = await mintToken()
})

afterAll(async () => {
  await stopServer(server)
})

function routeKey(route) {
  return `${route.method} ${route.path}`
}

// Turn a route path template into a concrete URL for injection, e.g.
// '/baseline/validate/{uploadId}' -> '/baseline/validate/x'. The value is
// deliberately invalid so that, once authenticated, param validation short-
// circuits with a 400 before any handler reaches an external service.
function concreteUrl(path) {
  return path.replaceAll(/\{[^}]*\}/g, 'x')
}

// Explicitly public: the route opted out with `auth: false`.
function isExplicitlyPublic(route) {
  return route.settings.auth === false
}

// Explicitly protected: the route names the 'defra-jwt' strategy itself.
function explicitlyRequiresDefraJwt(route) {
  const auth = route.settings.auth
  return Boolean(
    auth &&
    typeof auth === 'object' &&
    auth.mode === 'required' &&
    Array.isArray(auth.strategies) &&
    auth.strategies.includes('defra-jwt')
  )
}

// Inherits the server-wide default (no per-route auth config). This is the
// intended pattern for new routes; it is only secure because the default
// requires 'defra-jwt' — which the "enforces the default" test below proves.
function inheritsServerDefault(route) {
  return route.settings.auth == null
}

describe('auth coverage (secure by default)', () => {
  it('leaves no route unprotected unless it is an allowlisted public route', () => {
    const offenders = []
    for (const route of server.table()) {
      const key = routeKey(route)
      if (isExplicitlyPublic(route)) {
        if (!PUBLIC_ROUTES.has(key)) {
          offenders.push(`${key} (auth:false but not on PUBLIC_ROUTES)`)
        }
        continue
      }
      if (!explicitlyRequiresDefraJwt(route) && !inheritsServerDefault(route)) {
        offenders.push(`${key} (auth is set but does not require defra-jwt)`)
      }
    }
    expect(
      offenders,
      `Secure-by-default violations. A route must either require defra-jwt ` +
        `(explicitly or by inheriting the server default), or set auth:false AND ` +
        `be listed in PUBLIC_ROUTES with a justification:\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('requires every allowlisted route that is registered to opt out with auth:false', () => {
    const table = new Map(server.table().map((r) => [routeKey(r), r]))
    for (const [key, reason] of PUBLIC_ROUTES) {
      const route = table.get(key)
      if (!route) {
        // Allowlisted but not registered in this environment (e.g. /db-info is
        // omitted in prod). Nothing to assert.
        continue
      }
      expect(
        isExplicitlyPublic(route),
        `${key} is on PUBLIC_ROUTES ("${reason}") but does not set auth:false`
      ).toBe(true)
    }
  })

  it('configures the server default to require the defra-jwt strategy', () => {
    // The lynchpin of secure-by-default: if this is removed or weakened, every
    // route that relies on inheritance (rather than an explicit auth config)
    // silently falls open. Asserting it directly scales to all inherited routes
    // at once, independent of any single URL.
    const def = server.auth.settings.default
    expect(def, 'server.auth.default(...) is not set').toBeTruthy()
    expect(def.mode).toBe('required')
    expect(def.strategies).toContain('defra-jwt')
  })

  it('rejects an unauthenticated request to EVERY route that inherits the default (401)', async () => {
    // Auth runs before payload/param validation, so a no-token request to any
    // inherited route must 401 regardless of body. Parametrising over the live
    // table means coverage of the default scales with the routes, not a pinned
    // URL — a new inherited route is covered automatically.
    const offenders = []
    for (const route of server.table()) {
      if (!inheritsServerDefault(route)) {
        continue
      }
      const res = await server.inject({
        method: route.method,
        url: concreteUrl(route.path)
      })
      if (res.statusCode !== HTTP_UNAUTHORIZED) {
        offenders.push(`${routeKey(route)} → ${res.statusCode} (expected 401)`)
      }
    }
    expect(
      offenders,
      `Routes inheriting the default did not fail closed without a token:\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('accepts a valid token on an inherited route — proving the default uses defra-jwt, not just "something" (not 401)', async () => {
    // Same inherited route, this time WITH a valid signed token: auth passes and
    // the request proceeds to param validation (400 for the bogus uploadId).
    // The only variable vs the no-token case is the Authorization header, so a
    // non-401 here proves the default genuinely accepts a verified defra-jwt.
    const res = await server.inject({
      method: 'GET',
      url: '/upload/not-a-uuid/status',
      headers: buildAuthHeaders(token, process.env.AUTH_FORWARD_SECRET)
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('rejects an explicitly protected route without a token (401)', async () => {
    const res = await server.inject({ method: 'GET', url: '/projects' })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  it('serves an allowlisted public route without a token (200)', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(HTTP_OK)
  })
})
