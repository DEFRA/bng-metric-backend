import { config } from '../config.js'

// The plain pool options shared by the `postgres` plugin (via server.js) and the
// baseline worker thread. Kept in one place so both build their pools from the
// same config keys. The Hapi plugin additionally supplies `secureContext` for
// IAM SSL; the worker does not (see create-pool.js).
function postgresOptionsFromConfig() {
  return {
    host: config.get('postgres.host'),
    port: config.get('postgres.port'),
    user: config.get('postgres.user'),
    database: config.get('postgres.database'),
    iamAuthentication: config.get('postgres.iamAuthentication'),
    localPassword: config.get('postgres.localPassword'),
    region: config.get('aws.region')
  }
}

export { postgresOptionsFromConfig }
