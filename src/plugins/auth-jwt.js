// Hapi auth scheme + strategy ('defra-jwt') that authenticates requests the
// frontend forwards. The frontend sits in front of Defra ID, verifies the
// id_token at login, and forwards it to the backend over two headers:
//
//   x-defra-id-token     base64 of the compact id_token JWT (header.payload.sig)
//   x-defra-id-signature lowercase-hex HMAC-SHA256 of that header value, keyed
//                        by the shared AUTH_FORWARD_SECRET
//
// The backend lives in a private subnet and makes ZERO network calls: it does
// NOT verify the JWT signature against a JWKS, run OIDC discovery, or reach the
// IdP at all. Trust is established by the shared-secret HMAC over the forwarded
// token (only the frontend holds the secret), and the token's own exp/nbf are
// enforced locally with a small clock-skew grace. The decoded JWT payload then
// becomes request.auth.credentials; any failure returns a clean 401
// (Boom.unauthorized), never a 500. We log only a short failure category and
// NEVER the token, claims, secret, or signature.
import Boom from '@hapi/boom'
import { decodeJwt } from 'jose'
import * as crypto from 'node:crypto'

import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const HEADER_TOKEN = 'x-defra-id-token'
const HEADER_SIGNATURE = 'x-defra-id-signature'
const HMAC_ALGORITHM = 'sha256'
const HEX_ENCODING = 'hex'
const BASE64_ENCODING = 'base64'
const UTF8_ENCODING = 'utf8'
// A compact JWT is header.payload.signature — three dot-separated segments.
const JWT_SEGMENT_COUNT = 3
const MILLISECONDS_PER_SECOND = 1000
// Allow a small grace either side of exp/nbf to tolerate clock drift between the
// frontend, the backend, and the IdP that issued the token.
const CLOCK_SKEW_SECONDS = 60

// Failure categories used for logging. They are deliberately coarse: they tell
// an operator WHICH stage rejected the request without ever revealing the token.
const CATEGORY_MISSING_HEADERS = 'missing-headers'
const CATEGORY_BAD_SIGNATURE = 'bad-signature'
const CATEGORY_MALFORMED = 'malformed'
const CATEGORY_EXPIRED = 'expired'

function nowSeconds() {
  return Math.floor(Date.now() / MILLISECONDS_PER_SECOND)
}

// Constant-time HMAC verification. We recompute the HMAC over the EXACT
// x-defra-id-token header value and compare it to the supplied signature using
// timingSafeEqual on equal-length Buffers. A length mismatch short-circuits to a
// failure (timingSafeEqual throws on unequal lengths), so we check it first.
function verifyHmac(secret, tokenBase64, signatureHex) {
  const computed = crypto
    .createHmac(HMAC_ALGORITHM, secret)
    .update(tokenBase64)
    .digest(HEX_ENCODING)
  const computedBuf = Buffer.from(computed, HEX_ENCODING)
  const suppliedBuf = Buffer.from(signatureHex, HEX_ENCODING)
  if (computedBuf.length !== suppliedBuf.length) {
    return false
  }
  return crypto.timingSafeEqual(computedBuf, suppliedBuf)
}

// Decode the base64 header value back to the compact JWT string and confirm it
// has the three segments of a compact JWT. Returns the JWT string, or throws if
// the value is not decodable base64 or not a compact JWT.
function decodeToken(tokenBase64) {
  const compactJwt = Buffer.from(tokenBase64, BASE64_ENCODING).toString(
    UTF8_ENCODING
  )
  const segments = compactJwt.split('.')
  if (segments.length !== JWT_SEGMENT_COUNT || segments.some((s) => !s)) {
    throw new Error('Token is not a compact JWT')
  }
  return compactJwt
}

// Enforce the token's own time bounds locally (no network). exp must be in the
// future allowing for clock skew; nbf, if present, must be in the past allowing
// for clock skew. Throws if the token is expired or not yet valid.
function enforceExpiry(claims) {
  const now = nowSeconds()
  if (
    typeof claims.exp !== 'number' ||
    now >= claims.exp + CLOCK_SKEW_SECONDS
  ) {
    throw new Error('Token expired')
  }
  if (typeof claims.nbf === 'number' && now < claims.nbf - CLOCK_SKEW_SECONDS) {
    throw new Error('Token not yet valid')
  }
}

function defraJwtScheme(_server, options) {
  const secret = options.authForwardSecret

  return {
    authenticate: (request, h) => {
      const tokenBase64 = request.headers[HEADER_TOKEN]
      const signatureHex = request.headers[HEADER_SIGNATURE]

      if (!tokenBase64 || !signatureHex) {
        logger.warn(
          { category: CATEGORY_MISSING_HEADERS },
          'Rejected request: missing forwarded-auth headers'
        )
        throw Boom.unauthorized('Missing authentication headers')
      }

      if (!verifyHmac(secret, tokenBase64, signatureHex)) {
        logger.warn(
          { category: CATEGORY_BAD_SIGNATURE },
          'Rejected request: HMAC signature mismatch'
        )
        throw Boom.unauthorized('Invalid authentication signature')
      }

      let claims
      try {
        claims = decodeJwt(decodeToken(tokenBase64))
      } catch {
        logger.warn(
          { category: CATEGORY_MALFORMED },
          'Rejected request: malformed forwarded token'
        )
        throw Boom.unauthorized('Malformed token')
      }

      try {
        enforceExpiry(claims)
      } catch {
        logger.warn(
          { category: CATEGORY_EXPIRED },
          'Rejected request: token expired or not yet valid'
        )
        throw Boom.unauthorized('Token expired or not yet valid')
      }

      return h.authenticated({ credentials: claims })
    }
  }
}

const authJwt = {
  plugin: {
    name: 'auth-jwt',
    register(server, options) {
      logger.info(
        { clockSkewSeconds: CLOCK_SKEW_SECONDS },
        'defra-jwt auth strategy registered (local HMAC verification, no network)'
      )
      server.auth.scheme('defra-jwt', defraJwtScheme)
      server.auth.strategy('defra-jwt', 'defra-jwt', options)
    }
  }
}

export { authJwt }
