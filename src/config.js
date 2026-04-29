import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const postgresHost = process.env.POSTGRES_HOST ?? 'localhost'

const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  postgres: {
    host: {
      doc: 'Host for postgres',
      format: String,
      default: postgresHost,
      env: 'DB_HOST'
    },
    port: {
      doc: 'Port for postgres',
      format: 'port',
      default: 5432,
      env: 'DB_PORT'
    },
    database: {
      doc: 'Database name for postgres',
      format: String,
      default: 'bng_metric_backend',
      env: 'DB_DATABASE'
    },
    user: {
      doc: 'User for postgres',
      format: String,
      default: 'dev',
      env: 'DB_USER'
    },
    iamAuthentication: {
      doc: 'Enable IAM authentication for postgres',
      format: Boolean,
      default: isProduction,
      env: 'DB_IAM_AUTHENTICATION'
    },
    localPassword: {
      doc: 'Password for local development. Used when iamAuthentication is not enabled',
      format: String,
      default: 'dev',
      env: 'DB_LOCAL_PASSWORD'
    }
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'bng-metric-backend'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: [
      'local',
      'infra-dev',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : ['req', 'res', 'responseTime']
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  isMetricsEnabled: {
    doc: 'Enable metrics reporting',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_METRICS'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  useSwagger: {
    doc: 'Enable Swagger API documentation at /docs',
    format: Boolean,
    default: false,
    env: 'USE_SWAGGER'
  },
  cdpUploader: {
    url: {
      doc: 'Endpoint for the CDP Uploader service. Auto-derived from ENVIRONMENT if not set.',
      format: String,
      default: null,
      nullable: true,
      env: 'CDP_UPLOADER_URL'
    },
    bucket: {
      doc: 'S3 bucket for file uploads',
      format: String,
      default: 'baseline-files',
      env: 'CDP_UPLOADER_BUCKET'
    }
  },
  aws: {
    region: {
      doc: 'AWS region',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    },
    endpointUrl: {
      doc: 'Override AWS endpoint URL (e.g. for localstack in local development)',
      format: String,
      default: null,
      nullable: true,
      env: 'AWS_ENDPOINT_URL'
    },
    accessKeyId: {
      doc: 'AWS access key ID (used in local development only)',
      format: String,
      default: 'test',
      env: 'AWS_ACCESS_KEY_ID'
    },
    secretAccessKey: {
      doc: 'AWS secret access key (used in local development only)',
      format: String,
      default: 'test',
      env: 'AWS_SECRET_ACCESS_KEY'
    }
  }
})

config.validate({ allowed: 'strict' })

export { config }
