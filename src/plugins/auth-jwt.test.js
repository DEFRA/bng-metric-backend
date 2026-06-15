import { describe, test, expect, beforeAll } from 'vitest'
import Hapi from '@hapi/hapi'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

import { authJwt } from './auth-jwt.js'

const ISSUER = 'https://test-issuer.example'
const AUDIENCE = 'test-client'
const KID = 'test-key'
const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const ONE_MINUTE_SECONDS = 60

let privateKey
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
