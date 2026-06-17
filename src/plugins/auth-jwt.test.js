import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest'
import Hapi from '@hapi/hapi'
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  createRemoteJWKSet
} from 'jose'

import { authJwt } from './auth-jwt.js'

// Keep every jose primitive real, but let the remote-JWKS (discovery) path run
// without network I/O: only createRemoteJWKSet is mocked, pointed at a local key
// set by the discovery tests.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createRemoteJWKSet: vi.fn() }
})

const ISSUER = 'https://test-issuer.example'
const AUDIENCE = 'test-client'
const KID = 'test-key'
const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const ONE_MINUTE_SECONDS = 60

let privateKey
let publicJwks
let server

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

async function mint(
  claims = {},
  { issuer = ISSUER, audience = AUDIENCE, exp = '1h' } = {}
) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(claims.sub ?? 'user-1')
    .setExpirationTime(exp)
    .sign(privateKey)
}

function inject(token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {}
  return server.inject({ method: 'GET', url: '/protected', headers })
}

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256')
  privateKey = keyPair.privateKey
  const jwk = await exportJWK(keyPair.publicKey)
  jwk.kid = KID
  jwk.alg = 'RS256'
  jwk.use = 'sig'
  const jwks = { keys: [jwk] }
  publicJwks = jwks

  server = Hapi.server()
  await server.register({
    plugin: authJwt.plugin,
    options: { localJwks: jwks, issuer: ISSUER, audience: AUDIENCE }
  })
  server.route({
    method: 'GET',
    path: '/protected',
    options: { auth: 'defra-jwt' },
    handler: (request) => ({ sub: request.auth.credentials.sub })
  })
  await server.initialize()
})

describe('defra-jwt strategy', () => {
  test('401 when no Authorization header is present', async () => {
    const res = await inject()
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 when the Authorization header is not a Bearer token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Token abc' }
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('200 with a valid token; credentials are the verified payload', async () => {
    const res = await inject(await mint({ sub: 'user-42' }))
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.sub).toBe('user-42')
  })

  test('401 for a token from the wrong issuer', async () => {
    const res = await inject(
      await mint({ sub: 'x' }, { issuer: 'https://evil' })
    )
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 for a token with the wrong audience', async () => {
    const res = await inject(await mint({ sub: 'x' }, { audience: 'other' }))
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 for an expired token', async () => {
    const res = await inject(
      await mint({ sub: 'x' }, { exp: nowSeconds() - ONE_MINUTE_SECONDS })
    )
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 for a garbage token', async () => {
    const res = await inject('not.a.jwt')
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})

describe('defra-jwt strategy — discovery (remote JWKS) path', () => {
  const DISCOVERY_URL = 'https://idp.example/.well-known/openid-configuration'
  const JWKS_URI = 'https://idp.example/jwks'

  async function buildServer(options) {
    const s = Hapi.server()
    await s.register({ plugin: authJwt.plugin, options })
    s.route({
      method: 'GET',
      path: '/protected',
      options: { auth: 'defra-jwt' },
      handler: (request) => ({ sub: request.auth.credentials.sub })
    })
    await s.initialize()
    return s
  }

  function injectTo(s, token) {
    return s.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` }
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(createRemoteJWKSet).mockReset()
  })

  test('discovers the JWKS and verifies a token against it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ jwks_uri: JWKS_URI, issuer: ISSUER })
      }))
    )
    vi.mocked(createRemoteJWKSet).mockReturnValue(createLocalJWKSet(publicJwks))

    const s = await buildServer({ discoveryUrl: DISCOVERY_URL })
    const res = await injectTo(s, await mint({ sub: 'remote-user' }))

    expect(global.fetch).toHaveBeenCalledWith(DISCOVERY_URL)
    expect(createRemoteJWKSet).toHaveBeenCalledWith(new URL(JWKS_URI))
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.sub).toBe('remote-user')
    await s.stop()
  })

  test('401 and resets the cached verifier so discovery is retried after a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }))
    )

    const s = await buildServer({ discoveryUrl: DISCOVERY_URL })
    const token = await mint({ sub: 'x' })

    const first = await injectTo(s, token)
    const second = await injectTo(s, token)

    expect(first.statusCode).toBe(HTTP_UNAUTHORIZED)
    expect(second.statusCode).toBe(HTTP_UNAUTHORIZED)
    // The verifier promise is cleared on failure, so each request re-discovers.
    expect(global.fetch).toHaveBeenCalledTimes(2)
    await s.stop()
  })

  test('accepts a localJwks supplied as a JSON string', async () => {
    const s = await buildServer({
      localJwks: JSON.stringify(publicJwks),
      issuer: ISSUER,
      audience: AUDIENCE
    })
    const res = await injectTo(s, await mint({ sub: 'string-jwks-user' }))

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.sub).toBe('string-jwks-user')
    await s.stop()
  })
})
