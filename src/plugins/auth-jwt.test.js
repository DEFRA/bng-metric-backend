import { describe, test, expect, beforeAll, vi } from 'vitest'
import Hapi from '@hapi/hapi'
import * as crypto from 'node:crypto'
import { SignJWT, generateKeyPair } from 'jose'

import { authJwt } from './auth-jwt.js'

// Wrap node:crypto so the constant-time compare can be asserted: the wrapper
// records each call on a spy then ALWAYS delegates to the real timingSafeEqual,
// so verification still works even though clearMocks resets the spy between
// tests. State lives in vi.hoisted so it is initialised before the hoisted
// vi.mock factory runs.
const { timingSafeEqualSpy } = vi.hoisted(() => ({
  timingSafeEqualSpy: vi.fn()
}))
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    timingSafeEqual: (a, b) => {
      timingSafeEqualSpy(a, b)
      return actual.timingSafeEqual(a, b)
    }
  }
})

const SECRET = 'unit-test-auth-forward-secret'
const KID = 'test-key'
const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const ONE_MINUTE_SECONDS = 60
const CLOCK_SKEW_SECONDS = 60
const HMAC_ALGORITHM = 'sha256'

const HEADER_TOKEN = 'x-defra-id-token'
const HEADER_SIGNATURE = 'x-defra-id-signature'

let privateKey
let server

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

// Mint a real compact JWT. The backend never verifies the signature, but minting
// with a real key produces a well-formed token with valid claims to decode.
async function mint(claims = {}, { exp = '1h', nbf } = {}) {
  let builder = new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setSubject(claims.sub ?? 'user-1')
    .setExpirationTime(exp)
  if (nbf !== undefined) {
    builder = builder.setNotBefore(nbf)
  }
  return builder.sign(privateKey)
}

// Build the forwarded-auth headers the frontend would send: base64 token plus
// the lowercase-hex HMAC-SHA256 of that token value keyed by the shared secret.
function buildAuthHeaders(token, secret = SECRET) {
  const tokenBase64 = Buffer.from(token).toString('base64')
  const signature = crypto
    .createHmac(HMAC_ALGORITHM, secret)
    .update(tokenBase64)
    .digest('hex')
  return { [HEADER_TOKEN]: tokenBase64, [HEADER_SIGNATURE]: signature }
}

function inject(headers = {}) {
  return server.inject({ method: 'GET', url: '/protected', headers })
}

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256')
  privateKey = keyPair.privateKey

  server = Hapi.server()
  await server.register({
    plugin: authJwt.plugin,
    options: { authForwardSecret: SECRET }
  })
  server.route({
    method: 'GET',
    path: '/protected',
    options: { auth: 'defra-jwt' },
    handler: (request) => ({ sub: request.auth.credentials.sub })
  })
  await server.initialize()
})

describe('defra-jwt strategy (forwarded HMAC)', () => {
  test('200 with a valid forwarded token; credentials are the decoded payload', async () => {
    const token = await mint({ sub: 'user-42' })
    const res = await inject(buildAuthHeaders(token))
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.sub).toBe('user-42')
  })

  test('401 when both forwarded headers are missing', async () => {
    const res = await inject()
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 when the token header is missing', async () => {
    const token = await mint({ sub: 'x' })
    const headers = buildAuthHeaders(token)
    delete headers[HEADER_TOKEN]
    const res = await inject(headers)
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 when the signature header is missing', async () => {
    const token = await mint({ sub: 'x' })
    const headers = buildAuthHeaders(token)
    delete headers[HEADER_SIGNATURE]
    const res = await inject(headers)
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 when the signature is computed with the wrong secret', async () => {
    const token = await mint({ sub: 'x' })
    const headers = buildAuthHeaders(token, 'a-different-secret-entirely')
    const res = await inject(headers)
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 when the token is tampered with after the signature is computed', async () => {
    const token = await mint({ sub: 'x' })
    const headers = buildAuthHeaders(token)
    // Re-base64 a different token but keep the original signature: a mismatch.
    const otherToken = await mint({ sub: 'attacker' })
    headers[HEADER_TOKEN] = Buffer.from(otherToken).toString('base64')
    const res = await inject(headers)
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 when the signature length differs from the computed HMAC', async () => {
    const token = await mint({ sub: 'x' })
    const headers = buildAuthHeaders(token)
    // A too-short hex signature: lengths differ, so the compare must fail safely.
    headers[HEADER_SIGNATURE] = 'abcd'
    const res = await inject(headers)
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 for an expired token (beyond the clock-skew grace)', async () => {
    const token = await mint(
      { sub: 'x' },
      { exp: nowSeconds() - (CLOCK_SKEW_SECONDS + ONE_MINUTE_SECONDS) }
    )
    const res = await inject(buildAuthHeaders(token))
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 for a token that is not yet valid (nbf beyond the clock-skew grace)', async () => {
    const future = nowSeconds() + CLOCK_SKEW_SECONDS + ONE_MINUTE_SECONDS
    const token = await mint({ sub: 'x' }, { nbf: future })
    const res = await inject(buildAuthHeaders(token))
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('200 for a token that expired within the clock-skew grace window', async () => {
    const token = await mint(
      { sub: 'skew-user' },
      { exp: nowSeconds() - Math.floor(CLOCK_SKEW_SECONDS / 2) }
    )
    const res = await inject(buildAuthHeaders(token))
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.sub).toBe('skew-user')
  })

  test('401 when the token header is not valid base64-encoded JWT', async () => {
    // Sign over a header value that decodes to a non-JWT string.
    const tokenBase64 = Buffer.from('not-a-jwt-at-all').toString('base64')
    const signature = crypto
      .createHmac(HMAC_ALGORITHM, SECRET)
      .update(tokenBase64)
      .digest('hex')
    const res = await inject({
      [HEADER_TOKEN]: tokenBase64,
      [HEADER_SIGNATURE]: signature
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('401 when the token decodes to something with three dots but invalid JWT payload', async () => {
    // header.payload.sig shape but payload is not valid base64url JSON.
    const compact = 'aaa.bbb.ccc'
    const tokenBase64 = Buffer.from(compact).toString('base64')
    const signature = crypto
      .createHmac(HMAC_ALGORITHM, SECRET)
      .update(tokenBase64)
      .digest('hex')
    const res = await inject({
      [HEADER_TOKEN]: tokenBase64,
      [HEADER_SIGNATURE]: signature
    })
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED)
  })

  test('uses node:crypto timingSafeEqual for the signature comparison', async () => {
    timingSafeEqualSpy.mockClear()
    const token = await mint({ sub: 'timing-user' })
    const res = await inject(buildAuthHeaders(token))
    expect(res.statusCode).toBe(HTTP_OK)
    expect(timingSafeEqualSpy).toHaveBeenCalled()
    // Both buffers passed to the constant-time compare must be equal length.
    const [computedBuf, suppliedBuf] = timingSafeEqualSpy.mock.calls.at(-1)
    expect(computedBuf.length).toBe(suppliedBuf.length)
  })
})
