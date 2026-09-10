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
  validation: {
    workerCount: {
      doc: 'Worker threads running GEOS geometry validation. Capped at availableParallelism() - 1. Each worker settles at ~250 MB of WebAssembly heap after a large file and never gives it back, so this is a memory budget as much as a throughput setting — check the ECS task memory limit before raising it.',
      format: 'int',
      default: 2,
      env: 'VALIDATION_WORKER_COUNT'
    },
    workerQueueLimit: {
      doc: 'Validations allowed to wait for a free worker before new ones are refused with a 503 telling the user to try again. Bounded deliberately: an unbounded queue turns a traffic spike into a backlog of requests the client has already given up on. Raised from 8 because depth is a poor proxy for wait when service time spans two orders of magnitude: a 143 KB GeoPackage validates in 20-60 ms, so 8 slots was under half a second of work on a one-worker pool and whether a burst was refused came down to arrival jitter rather than load. VALIDATION_QUEUE_WAIT_LIMIT_MS is the real bound on how long anyone waits and applies whatever this is set to. Cheap since the gate stopped unpacking: a queued request holds a file path and its downloaded temp file, not a parsed GeoPackage, and no parse-budget reservation — that is taken past the wait, when the layers are unpacked. See docs/geometry-validation.md. Large files are therefore held out of the deeper slots by VALIDATION_QUEUE_WAIT_LIMIT_MS rather than by the parse budget: they can queue, but anything queued more than ~3 deep is refused as queue_wait before a worker reaches it.',
      format: 'int',
      default: 20,
      env: 'VALIDATION_WORKER_QUEUE_LIMIT'
    },
    admissionLimit: {
      doc: 'Requests allowed in flight at once, from admission through to response. Reserved ATOMICALLY before the file is fetched from S3, which VALIDATION_WORKER_QUEUE_LIMIT cannot be: that limit is reached through a check, and every thread of a synchronised burst passes it while the pool is still empty, so the refusal lands after the download the check exists to avoid. Much larger than the queue depth on purpose — it bounds I/O, where the queue bounds CPU, and sizing it down to the queue depth would refuse bursts the service demonstrably serves (64 concurrent 143 KB uploads all succeeded on a one-worker pool). Lower it to cap concurrent uploads harder; the cost is refusing work that would have been served.',
      format: 'int',
      default: 64,
      env: 'VALIDATION_ADMISSION_LIMIT'
    },
    workerTimeoutMs: {
      doc: 'Budget for one validation on a worker. On overrun the worker is terminated (GEOS cannot be interrupted from JavaScript) and the request fails with VALIDATION_FAILED. A rung of the timeout ladder in docs/geometry-validation.md, where the rungs sum rather than nest, so it had to come down to fit the frontend budget. Still generous: the slowest of 672 validations in a full perf run, on a contended 2-vCPU box, was 2,155 ms (p95 1,094 ms).',
      format: 'int',
      default: 5000,
      env: 'VALIDATION_WORKER_TIMEOUT_MS'
    },
    queueWaitLimitMs: {
      doc: 'Longest a validation may wait for a free worker before it is refused as busy instead of started. Without it the worst case is queueLimit x workerTimeoutMs, far past any client patience — and starting work nobody is waiting for helps nobody. The client retries into a pool that is actually free.',
      format: 'int',
      default: 5000,
      env: 'VALIDATION_QUEUE_WAIT_LIMIT_MS'
    },
    maxParcelCount: {
      doc: 'Features a GeoPackage may contain before the format gate refuses it as too large, counted across the boundary, habitat, hedgerow and watercourse layers — every layer the gate reads, not habitat parcels alone, because a limit that counted only parcels would let a file of half a million hedgerows through.',
      format: 'int',
      default: 25000,
      env: 'VALIDATION_MAX_PARCEL_COUNT'
    },
    parseBudgetBytes: {
      doc: 'Byte budget rationed across the GeoPackages being UNPACKED at once, and the primary load shed: tune it before VALIDATION_WORKER_QUEUE_LIMIT, which is only the backstop behind it. Each upload is charged an ESTIMATE of its unpack cost — 2 MB + 10x the file size — so these are credit-bytes rather than heap-bytes; docs/geometry-validation.md carries the measurements behind the ratio. Size it against the task memory limit together with VALIDATION_WORKER_COUNT (~250 MB per worker) and VALIDATION_MAX_RSS_BYTES.',
      format: 'int',
      default: 576716800,
      env: 'VALIDATION_PARSE_BUDGET_BYTES'
    },
    maxRssBytes: {
      doc: "Process RSS above which Hapi refuses new requests with a 503, before the handler runs. This is the backstop the parse budget cannot be: that budget rations bytes it knows about — the files being parsed — and measurement showed RSS reaching 1.2 GB while the budget was never exceeded, because most of the growth is the GEOS workers' WebAssembly heaps, V8's retained heap and native allocator arenas. None of those are visible to a JS-level count; all of them are visible in RSS, which is also the number the kernel OOM-killer reads. Sampled rather than exact (see loadSampleIntervalMs), so several requests can slip through between samples. Zero disables it. Set it BELOW the task memory limit with room for one in-flight request, not at it.",
      format: 'int',
      default: 0,
      env: 'VALIDATION_MAX_RSS_BYTES'
    },
    loadSampleIntervalMs: {
      doc: 'How often Hapi samples process load. Required to be non-zero for maxRssBytes to do anything at all — @hapi/heavy asserts on a zero interval with any limit set, so this is not merely a tuning knob. Short enough that a burst is noticed within a request or two, long enough not to sample on every event loop turn.',
      format: 'int',
      default: 1000,
      env: 'VALIDATION_LOAD_SAMPLE_INTERVAL_MS'
    },
    busyRetryAfterSeconds: {
      doc: 'Value of the Retry-After header sent with the 503 when validation is refused. The frontend HONOURS this — it is the base for how soon its polling page comes back — so it is the one place the retry pace is decided, rather than being duplicated on both sides. Short, because a full queue drains in the time it takes the workers to finish what they are holding.',
      format: 'int',
      default: 5,
      env: 'VALIDATION_BUSY_RETRY_AFTER_SECONDS'
    }
  },
  upload: {
    readyTimeoutMs: {
      doc: 'How long the validate route waits for the CDP Uploader to report the file ready. A safety net for a lost race, not a budget for the virus scan: the frontend only calls validate once its own status poll has seen "ready". Kept small because the ladder rungs sum — every second here is one the download and validation rungs cannot have.',
      format: 'int',
      default: 2000,
      env: 'UPLOAD_READY_TIMEOUT_MS'
    },
    downloadTimeoutMs: {
      doc: 'Budget for streaming the uploaded file out of S3. Another rung of the timeout ladder: it has to leave room for validation and persistence inside the frontend request budget, which is what bounds the file size this synchronous pipeline can actually handle.',
      format: 'int',
      default: 10000,
      env: 'UPLOAD_DOWNLOAD_TIMEOUT_MS'
    },
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
