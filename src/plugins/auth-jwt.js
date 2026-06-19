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
import Boom from '@hapi/boom'
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose'

const BEARER_PREFIX = 'Bearer '

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
  return {
    keySet: createRemoteJWKSet(new URL(discovery.jwks_uri)),
    issuer: options.issuer || discovery.issuer || undefined
  }
}

function bearerToken(authorization) {
  if (!authorization?.startsWith(BEARER_PREFIX)) {
    return null
  }
  return authorization.slice(BEARER_PREFIX.length).trim()
}

function defraJwtScheme(_server, options) {
  let verifierPromise

  const getVerifier = () => {
    if (!verifierPromise) {
      // Reset on failure so a transient discovery outage can be retried.
      verifierPromise = resolveVerifier(options).catch((error) => {
        verifierPromise = null
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

      try {
        const { keySet, issuer } = await getVerifier()
        const verifyOptions = {}
        if (issuer) {
          verifyOptions.issuer = issuer
        }
        if (options.audience) {
          verifyOptions.audience = options.audience
        }
        const { payload } = await jwtVerify(token, keySet, verifyOptions)
        return h.authenticated({ credentials: payload })
      } catch (error) {
        request.logger?.warn(
          { reason: error.code ?? error.message },
          'JWT verification failed'
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
      server.auth.scheme('defra-jwt', defraJwtScheme)
      server.auth.strategy('defra-jwt', 'defra-jwt', options)
    }
  }
}

export { authJwt }
