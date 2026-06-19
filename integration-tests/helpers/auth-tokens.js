import { SignJWT, exportJWK, generateKeyPair } from 'jose'

// Per-run RS256 key pair whose PUBLIC JWK is handed to the backend via the
// OIDC_LOCAL_JWKS env var (read by src/server.js → auth-jwt scheme), so the
// 'defra-jwt' strategy verifies test-minted tokens with createLocalJWKSet and
// never touches the network / discovery. Issuer + audience are pinned so the
// scheme enforces them and minted tokens must match.
const ISSUER = 'https://bng-integration-tests.local'
const AUDIENCE = 'bng-integration-client'
const KID = 'integration-test-key'
const DEFAULT_TOKEN_TTL = '1h'

let privateKey
let initPromise

/**
 * Generate the key pair (once) and publish the public JWK + issuer + audience
 * into the environment. MUST be awaited before createServer() so the auth
 * scheme is registered with the local key set.
 */
function initTestJwks() {
  if (!initPromise) {
    initPromise = (async () => {
      const keyPair = await generateKeyPair('RS256')
      privateKey = keyPair.privateKey
      const jwk = await exportJWK(keyPair.publicKey)
      jwk.kid = KID
      jwk.alg = 'RS256'
      jwk.use = 'sig'
      process.env.OIDC_LOCAL_JWKS = JSON.stringify({ keys: [jwk] })
      process.env.OIDC_ISSUER = ISSUER
      process.env.OIDC_AUDIENCE = AUDIENCE
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
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub ?? 'integration-user')
    .setExpirationTime(DEFAULT_TOKEN_TTL)
    .sign(privateKey)
}

/** Build the Authorization header object for a Bearer token. */
function authHeaders(token) {
  return { authorization: `Bearer ${token}` }
}

export { initTestJwks, mintToken, authHeaders, ISSUER, AUDIENCE }
