import { SignJWT, generateKeyPair } from 'jose'
import { createHmac } from 'node:crypto'

// The backend 'defra-jwt' scheme no longer verifies the JWT signature against a
// JWKS — it trusts the shared-secret HMAC over the forwarded token and reads the
// claims locally. We still mint a real RS256 JWT so the token is a valid compact
// JWT with the right claim shape; the private key is only used to produce that
// well-formed token, never verified by the backend.
const KID = 'integration-test-key'
const DEFAULT_TOKEN_TTL = '1h'
const HMAC_ALGORITHM = 'sha256'
const HEX_ENCODING = 'hex'
const BASE64_ENCODING = 'base64'
const HEADER_TOKEN = 'x-defra-id-token'
const HEADER_SIGNATURE = 'x-defra-id-signature'
// Shared HMAC secret used by both the minted headers and the backend's scheme.
// Long enough to satisfy the backend's startup non-trivial-length check.
const TEST_AUTH_FORWARD_SECRET = 'integration-test-auth-forward-secret'

let privateKey
let initPromise

/**
 * Generate the signing key pair (once) and publish the shared HMAC secret into
 * the environment. MUST be awaited before createServer() so the auth scheme is
 * registered with the same secret used to sign the forwarded headers.
 */
function initTestJwks() {
  if (!initPromise) {
    initPromise = (async () => {
      const keyPair = await generateKeyPair('RS256')
      privateKey = keyPair.privateKey
      if (!process.env.AUTH_FORWARD_SECRET) {
        process.env.AUTH_FORWARD_SECRET = TEST_AUTH_FORWARD_SECRET
      }
    })()
  }
  return initPromise
}

/**
 * Mint a signed id_token for the given claims. `sub` defaults so callers that
 * only care about "some authenticated user" can omit it.
 * @param {object} claims e.g. { sub, relationships, roles, currentRelationshipId }
 */
async function mintToken(claims = {}) {
  if (!privateKey) {
    await initTestJwks()
  }
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setSubject(claims.sub ?? 'integration-user')
    .setExpirationTime(DEFAULT_TOKEN_TTL)
    .sign(privateKey)
}

/**
 * Build the forwarded-auth headers for a compact JWT: the base64 token header
 * and the lowercase-hex HMAC-SHA256 signature over that header value.
 * @param {string} token compact JWT string
 * @param {string} secret shared HMAC secret (defaults to the test secret)
 */
function buildAuthHeaders(token, secret = currentSecret()) {
  const tokenBase64 = Buffer.from(token).toString(BASE64_ENCODING)
  const signature = createHmac(HMAC_ALGORITHM, secret)
    .update(tokenBase64)
    .digest(HEX_ENCODING)
  return {
    [HEADER_TOKEN]: tokenBase64,
    [HEADER_SIGNATURE]: signature
  }
}

function currentSecret() {
  return process.env.AUTH_FORWARD_SECRET ?? TEST_AUTH_FORWARD_SECRET
}

/**
 * Build the forwarded-auth header object for a minted token. Indirection point
 * kept so existing tests keep calling `authHeaders(token)`.
 */
function authHeaders(token) {
  return buildAuthHeaders(token)
}

export {
  initTestJwks,
  mintToken,
  authHeaders,
  buildAuthHeaders,
  TEST_AUTH_FORWARD_SECRET
}
