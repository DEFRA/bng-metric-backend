import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'
import { configDotenv } from 'dotenv'

convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'
const postgresHost = process.env.POSTGRES_HOST ?? 'localhost'
const localStack = 'http://localhost:4566'

if (isDevelopment) {
  configDotenv()
}

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
  s3: {
    endpoint: {
      doc: 'S3 endpoint URL (for localstack in development)',
      format: String,
      nullable: true,
      default: isDevelopment ? localStack : null,
      env: 'S3_ENDPOINT'
    },
    forcePathStyle: {
      doc: 'Use path-style addressing for S3 (required for localstack)',
      format: Boolean,
      default: isDevelopment,
      env: 'S3_FORCE_PATH_STYLE'
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
  upload: {
    maxFileSizeBytes: {
      doc: 'Maximum upload file size in bytes. Sent to the CDP Uploader on initiate so oversized files are rejected at source, and enforced again by the S3 download guard. Defaults to 100 MB.',
      format: Number,
      default: 104857600,
      env: 'UPLOAD_MAX_FILE_SIZE_BYTES'
    }
  },
  asyncValidation: {
    enabled: {
      doc: 'Register the async GeoPackage validate endpoints and start the job dispatcher. Must move in lock-step with the frontend flag of the same name: the frontend only calls /validate-async when its own flag is on.',
      format: Boolean,
      default: false,
      env: 'ASYNC_VALIDATION_ENABLED'
    },
    maxConcurrentJobs: {
      doc: 'How many validation jobs this instance runs at once. Each job occupies a worker thread and holds a whole GeoPackage, so this doubles as the memory ceiling for concurrent validation.',
      format: Number,
      default: 1,
      env: 'ASYNC_VALIDATION_MAX_CONCURRENT_JOBS'
    },
    pollIntervalMs: {
      doc: 'How often the dispatcher looks for work it was not nudged about — jobs left pending by an instance that died, or claimed by one that never finished.',
      format: Number,
      default: 5_000,
      env: 'ASYNC_VALIDATION_POLL_INTERVAL_MS'
    },
    leaseMs: {
      doc: 'How long a job may sit in processing before the reaper assumes its worker died and returns it to pending. Must exceed the slowest realistic validation.',
      format: Number,
      default: 300_000,
      env: 'ASYNC_VALIDATION_LEASE_MS'
    },
    maxAttempts: {
      doc: 'How many times a job is retried before it is failed for good. Guards against a file that reliably crashes its worker being retried forever.',
      format: Number,
      default: 3,
      env: 'ASYNC_VALIDATION_MAX_ATTEMPTS'
    },
    retentionMs: {
      doc: 'How long finished jobs are kept before the retention sweep deletes them. Jobs hold the uploading user token claims, so this is a data-minimisation control as well as housekeeping.',
      format: Number,
      default: 86_400_000,
      env: 'ASYNC_VALIDATION_RETENTION_MS'
    }
  },
  aws: {
    region: {
      doc: 'AWS region',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    }
  },
  oidc: {
    discoveryUrl: {
      doc: 'OIDC provider discovery endpoint. Used to resolve the JWKS URI and issuer for independently verifying the id_token the frontend forwards. Defaults to the cdp-defra-id-stub.',
      format: String,
      default:
        'http://localhost:3200/cdp-defra-id-stub/.well-known/openid-configuration',
      env: 'OIDC_DISCOVERY_URL'
    },
    audience: {
      doc: 'Expected JWT audience (the OIDC client id). Left empty against the cdp-defra-id-stub, whose tokens do not carry the client id as `aud` the way live B2C does; audience is only enforced when this is set.',
      format: String,
      default: '',
      env: 'OIDC_AUDIENCE'
    },
    issuer: {
      doc: 'Expected JWT issuer. Empty means derive it from the discovery document.',
      format: String,
      default: '',
      env: 'OIDC_ISSUER'
    }
  }
})

config.validate({ allowed: 'strict' })

export { config }
