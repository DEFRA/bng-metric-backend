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
  // authJwt        - 'defra-jwt' scheme/strategy (must be registered BEFORE the
  //                  default is set and before the router adds routes)
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
      options: {
        authForwardSecret: config.get('authForwardSecret')
      }
    }
  ])

  // Secure by default: every route requires the 'defra-jwt' strategy unless it
  // explicitly opts out with `auth: false`. Set here — at the root realm, after
  // the strategy is registered but BEFORE the router adds any routes — so the
  // default applies to all of them. A new route is therefore protected by
  // omission; forgetting to add auth fails closed, not open. The small set of
  // intentionally public routes (/health, /reference/*) opt out with
  // `auth: false` and are pinned by integration-tests/auth-coverage.test.js.
  // See docs/auth-route-policy.md.
  server.auth.default('defra-jwt')

  await server.register([router])

  return server
}

export { createServer }
