// Hapi auth scheme + strategy ('defra-jwt') that independently verifies the
// Defra ID id_token forwarded by the frontend (zero-trust: the backend never
// trusts the frontend's parsed claims). On success the verified JWT payload
// becomes request.auth.credentials; on any failure it returns a clean 401
// (Boom.unauthorized), distinct from a 400 validation error.
//
// Key source is swappable:
//   - Normal run: resolve jwks_uri + issuer from the OIDC discovery document
//     and verify against a remote JWKS (jose.createRemoteJWKSet).
//   - Tests / injected key set: pass `localJwks` (a JWKS object or JSON string)
//     and the scheme uses jose.createLocalJWKSet, skipping discovery entirely.
//
// Audience is optional: the cdp-defra-id-stub does not append the client id as
// `aud` the way live B2C does, so we only enforce audience when configured.
//
// Diagnostics: discovery and the JWKS are fetched over the network, and in a CDP
// container that egress must traverse the platform proxy and trust its CA. When
// it fails, the useful detail lives on error.cause (a bare `fetch failed` has no
// .code), so we flatten the cause and put the codes straight into the LOG
// MESSAGE — which survives a pipeline that drops unmapped structured fields. We
// classify the failure (idp-unreachable vs token-rejected) and log a one-off
// line on successful discovery, so a single deploy's logs reveal which stage
// (discovery, JWKS fetch, or token verification) actually failed.
import Boom from '@hapi/boom'
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose'
import { HttpsProxyAgent } from 'https-proxy-agent'

import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const BEARER_PREFIX = 'Bearer '
// jose namespaces its own error codes 'ERR_J…'. We use that to tell a genuine
// token/JWKS rejection apart from an underlying network/TLS failure, which
// surfaces from the same jwtVerify() call when the lazy JWKS fetch fails.
const JOSE_ERROR_PREFIX = 'ERR_J'
// Cap the cause-chain walk so a cyclic `cause` can never loop forever.
const MAX_CAUSE_DEPTH = 5

// Render one Error in the chain. The real reason for a failed fetch/proxy/TLS
// error often sits in its message and nested cause, not its `code` (e.g. undici
// wraps a rejected proxy CONNECT as a cancelled error whose code is the NUMBER
// 0), so only show a code when it is truthy and never let it hide the message.
function describeLink(error) {
  const code = error.code ? ` [${error.code}]` : ''
  return `${error.name ?? 'Error'}${code}: ${error.message}`
}

// Walk error.cause into a readable one-line chain that survives a log pipeline
// which drops unmapped structured fields — the diagnostic detail goes into the
// message itself, not just the structured `err`. This is what turns an opaque
// "fetch failed (cause: 0)" into e.g. "TypeError: fetch failed <- Error:
// Request was cancelled. <- Error [UND_ERR_ABORTED]: Proxy response (403) !==
// 200 when HTTP Tunneling", which names the proxy as the culprit.
function summariseError(error) {
  const links = []
  let current = error
  let depth = 0
  while (current && depth < MAX_CAUSE_DEPTH) {
    links.push(describeLink(current))
    current = current.cause
    depth += 1
  }
  return links.join(' <- ')
}

// A jose error means the token itself was rejected (bad signature, wrong
// issuer/audience, expired, no matching key). Anything else thrown from
// jwtVerify is the lazy JWKS fetch failing — i.e. we could not reach/trust the
// IdP, not a problem with the token.
function classifyVerifyError(error) {
  const isJoseError =
    typeof error.code === 'string' && error.code.startsWith(JOSE_ERROR_PREFIX)
  return isJoseError ? 'token-rejected' : 'idp-unreachable'
}

async function fetchDiscovery(discoveryUrl) {
  const response = await fetch(discoveryUrl)
  if (!response.ok) {
    throw new Error(
      `OIDC discovery request to ${discoveryUrl} failed: ${response.status}`
    )
  }
  return response.json()
}

// Resolve the verification key set + expected issuer once, lazily, and cache the
// promise so registration never blocks on network I/O and discovery runs at most
// once per process.
async function resolveVerifier(options) {
  if (options.localJwks) {
    const jwks =
      typeof options.localJwks === 'string'
        ? JSON.parse(options.localJwks)
        : options.localJwks
    return {
      keySet: createLocalJWKSet(jwks),
      issuer: options.issuer || undefined
    }
  }

  const discovery = await fetchDiscovery(options.discoveryUrl)
  const issuer = options.issuer || discovery.issuer || undefined
  // jose fetches the JWKS with node:https.get, which — unlike the global fetch()
  // used for discovery — does NOT pick up the undici/global-agent proxy: jose
  // reads `https.get` off a namespace import that never sees global-agent's
  // monkey-patch, so the call uses the original, unproxied https.get. In a CDP
  // container (no direct egress) that JWKS fetch fails instantly. Pass an
  // explicit proxy agent so it tunnels through the platform proxy — this is what
  // createRemoteJWKSet's `agent` option is documented for.
  const agent = options.httpProxy
    ? new HttpsProxyAgent(options.httpProxy)
    : undefined
  logger.info(
    { jwksUri: discovery.jwks_uri, issuer, jwksProxied: Boolean(agent) },
    `OIDC discovery resolved from ${options.discoveryUrl}`
  )
  return {
    keySet: createRemoteJWKSet(new URL(discovery.jwks_uri), { agent }),
    issuer
  }
}

function bearerToken(authorization) {
  if (!authorization?.startsWith(BEARER_PREFIX)) {
    return null
  }
  return authorization.slice(BEARER_PREFIX.length).trim()
}

function buildVerifyOptions(verifier, options) {
  const verifyOptions = {}
  if (verifier.issuer) {
    verifyOptions.issuer = verifier.issuer
  }
  if (options.audience) {
    verifyOptions.audience = options.audience
  }
  return verifyOptions
}

function defraJwtScheme(_server, options) {
  let verifierPromise

  const getVerifier = () => {
    if (!verifierPromise) {
      // Reset on failure so a transient discovery outage can be retried, and log
      // the full cause: this is the "can't reach / can't trust the IdP" path.
      verifierPromise = resolveVerifier(options).catch((error) => {
        verifierPromise = null
        logger.error(
          { err: error, discoveryUrl: options.discoveryUrl },
          `OIDC discovery/JWKS resolution failed — ${summariseError(error)}`
        )
        throw error
      })
    }
    return verifierPromise
  }

  return {
    authenticate: async (request, h) => {
      const token = bearerToken(request.headers.authorization)
      if (!token) {
        throw Boom.unauthorized('Missing bearer token', 'Bearer')
      }

      let verifier
      try {
        verifier = await getVerifier()
      } catch {
        // Already logged with the full cause in getVerifier above.
        throw Boom.unauthorized('Invalid bearer token', 'Bearer')
      }

      try {
        const { payload } = await jwtVerify(
          token,
          verifier.keySet,
          buildVerifyOptions(verifier, options)
        )
        return h.authenticated({ credentials: payload })
      } catch (error) {
        const category = classifyVerifyError(error)
        request.logger?.warn(
          { err: error, category },
          `JWT verification failed [${category}] — ${summariseError(error)}`
        )
        throw Boom.unauthorized('Invalid bearer token', 'Bearer')
      }
    }
  }
}

const authJwt = {
  plugin: {
    name: 'auth-jwt',
    register(server, options) {
      // Log the resolved egress config at startup so a misconfig is visible at
      // boot, not only on the first failed login.
      logger.info(
        {
          discoveryUrl: options.discoveryUrl,
          usingLocalJwks: Boolean(options.localJwks),
          audienceEnforced: Boolean(options.audience),
          issuerPinned: Boolean(options.issuer),
          httpProxyConfigured: Boolean(options.httpProxy)
        },
        'defra-jwt auth strategy registered'
      )
      server.auth.scheme('defra-jwt', defraJwtScheme)
      server.auth.strategy('defra-jwt', 'defra-jwt', options)
    }
  }
}

export { authJwt }
