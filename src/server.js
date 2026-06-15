import Hapi from '@hapi/hapi'
import { secureContext } from '@defra/hapi-secure-context'

import { config } from './config.js'
import { postgres } from './plugins/postgres.js'
import { authJwt } from './plugins/auth-jwt.js'
import { router } from './plugins/router.js'
import { requestLogger } from './common/helpers/logging/request-logger.js'
import { failAction } from './common/helpers/fail-action.js'
import { pulse } from './common/helpers/pulse.js'
import { requestTracing } from './common/helpers/request-tracing.js'
import { setupProxy } from './common/helpers/proxy/setup-proxy.js'

async function createServer() {
  setupProxy()
  const server = Hapi.server({
    host: config.get('host'),
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        },
        failAction
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false
        },
        xss: 'enabled',
        noSniff: true,
        xframe: true
      }
    },
    router: {
      stripTrailingSlash: true
    }
  })

  // Hapi Plugins:
  // requestLogger  - automatically logs incoming requests
  // requestTracing - trace header logging and propagation
  // secureContext  - loads CA certificates from environment config
  // postgres       - connection pool for PostgreSQL (must be after secureContext)
  // pulse          - provides shutdown handlers
  // authJwt        - 'defra-jwt' scheme/strategy (must be BEFORE router, since
  //                  routes reference auth: 'defra-jwt' at registration time)
  // router         - routes used in the app
  await server.register([
    requestLogger,
    requestTracing,
    secureContext,
    {
      plugin: postgres.plugin,
      options: {
        host: config.get('postgres.host'),
        port: config.get('postgres.port'),
        user: config.get('postgres.user'),
        database: config.get('postgres.database'),
        iamAuthentication: config.get('postgres.iamAuthentication'),
        localPassword: config.get('postgres.localPassword'),
        region: process.env.AWS_REGION ?? 'eu-west-2'
      }
    },
    pulse,
    {
      plugin: authJwt.plugin,
      options: resolveOidcAuthOptions()
    },
    router
  ])

  return server
}

// Resolve JWT-verification options. process.env is read at call time (not via
// convict, which captures env at import) so integration tests can inject a local
// key set + issuer/audience after import, before createServer() runs.
function resolveOidcAuthOptions() {
  return {
    discoveryUrl:
      process.env.OIDC_DISCOVERY_URL || config.get('oidc.discoveryUrl'),
    audience:
      process.env.OIDC_AUDIENCE || config.get('oidc.audience') || undefined,
    issuer: process.env.OIDC_ISSUER || config.get('oidc.issuer') || undefined,
    localJwks: process.env.OIDC_LOCAL_JWKS || undefined
  }
}

export { createServer }
