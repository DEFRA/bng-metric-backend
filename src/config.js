import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'
import { configDotenv } from 'dotenv'

convict.addFormats(convictFormatWithValidator)

/** Name of the boolean format registered below and used by every flag. */
const STRICT_BOOLEAN = 'strict-boolean'

/** Environment-variable spellings accepted as true. */
const TRUTHY_VALUES = new Set(['true', 'yes', 'on', '1'])

/** Environment-variable spellings accepted as false. */
const FALSY_VALUES = new Set(['false', 'no', 'off', '0'])

/**
 * Boolean flag read from an environment variable.
 *
 * Convict's built-in `Boolean` format only recognises the exact string
 * 'false' as false, so the conventional `FLAG=0` is coerced to TRUE — silently
 * enabling whatever the operator meant to switch off. This format accepts the
 * spellings people actually type (true/false, yes/no, on/off, 1/0, any case)
 * and rejects anything else outright, so a typo fails at startup rather than
 * leaving a flag in the opposite state to the one intended.
 */
convict.addFormat({
  name: STRICT_BOOLEAN,
  coerce: (value) => {
    if (typeof value === 'boolean') {
      return value
    }
    const normalised = String(value).trim().toLowerCase()
    if (TRUTHY_VALUES.has(normalised)) {
      return true
    }
    if (FALSY_VALUES.has(normalised)) {
      return false
    }
    // Left unchanged so validate below reports it, naming the bad value.
    return value
  },
  validate: (value) => {
    if (typeof value !== 'boolean') {
      throw new TypeError(
        `must be one of true/false, yes/no, on/off or 1/0 (got "${value}")`
      )
    }
  }
})

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
      format: STRICT_BOOLEAN,
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
      format: STRICT_BOOLEAN,
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
      format: STRICT_BOOLEAN,
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
    format: STRICT_BOOLEAN,
    default: isProduction,
    env: 'ENABLE_METRICS'
  },
  isPerfEvidenceEnabled: {
    doc: 'Emit perf-evidence log lines for the System Performance Issues spike',
    format: STRICT_BOOLEAN,
    default: true,
    env: 'ENABLE_PERF_EVIDENCE'
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
    format: STRICT_BOOLEAN,
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
  aws: {
    region: {
      doc: 'AWS region',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    }
  },
  osMaps: {
    apiKey: {
      doc: 'OS Data Hub API key for the OS Maps API (raster). Held by this service alone — the report builder and the browser map both see an internal URL and never the key. Empty disables the /os-tiles routes entirely. Supply as a CDP secret per environment, NOT via cdp-app-config.',
      format: String,
      default: '',
      sensitive: true,
      env: 'OS_API_KEY'
    },
    layer: {
      doc: 'OS Maps raster style. Must be one of the EPSG:27700 styles — British National Grid throughout is what keeps the basemap and the parcel geometry in exact registration.',
      format: String,
      default: 'Light_27700',
      env: 'OS_MAPS_LAYER'
    },
    maxZoom: {
      doc: 'Zoom ceiling imposed by the OS PLAN, as distinct from the product. An OpenData key must set this to 9 or every EPSG:27700 tile above it returns 403 "A Premium Plan is required to access Premium Data". Left empty for a Premium/PSGA key, which is why it does not default to 9 — defaulting to the free ceiling would silently discard resolution a Premium key has paid for.',
      format: String,
      default: '',
      env: 'OS_MAPS_MAX_ZOOM'
    },
    cacheTtlSeconds: {
      doc: 'How long a fetched tile stays in the process-local tile cache. Tiles are static, so this is long by default.',
      format: Number,
      default: 604800,
      env: 'OS_MAPS_CACHE_TTL_SECONDS'
    },
    cacheMaxBytes: {
      doc: 'Tile cache budget, in bytes — catbox measures a memory cache by size rather than by entry count, which suits tiles because a sparse rural tile and a dense urban one differ by an order of magnitude. One site map is around 30 tiles; a large site with parcel thumbnails is a few hundred, so the default holds several whole reports.',
      format: Number,
      default: 67108864,
      env: 'OS_MAPS_CACHE_MAX_BYTES'
    },
    attribution: {
      doc: "Basemap credit burned into the bottom corner of every map drawn from OS tiles, and repeated once as a tagged paragraph so assistive technology reads it too. A PDF cannot carry the dynamic credit control a browser map uses, so the wording has to be part of the document. Provisional: the required wording is OS's to dictate and has not been confirmed with them.",
      format: String,
      default:
        'Contains OS data © Crown copyright and database right ' +
        new Date().getFullYear(),
      env: 'OS_MAPS_ATTRIBUTION'
    },
    attributionShort: {
      doc: 'The credit used where the full wording cannot fit legibly — a parcel thumbnail is 18 mm square and cannot carry a whole sentence at any readable size. Same provisional status as the full wording. Empty means such a map carries no credit at all, which is why the renderer draws no OS tiles behind a frame it cannot credit.',
      format: String,
      default: '© Crown copyright',
      env: 'OS_MAPS_ATTRIBUTION_SHORT'
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
