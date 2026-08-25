// Observability-only plugin that gathers EVIDENCE for the "no rate limiting
// anywhere" spike issue (Item W3). It NEVER throttles, rejects, or delays a
// request — there is no limiter here. It counts requests in a sliding window
// and logs when the service is driven past a burst threshold, so the logs
// demonstrate an uncapped request rate (point a load tool at /reference/* and
// watch the count climb with no 429 in sight).
//
// The count is deliberately SERVICE-WIDE rather than per client. Every deployed
// environment puts this service behind CDP's load balancer
// (bng-metric-backend.<env>.cdp-int.defra.cloud), so the peer address Hapi
// reports is the balancer's rather than the caller's, and per-IP buckets would
// collapse all external traffic into a handful of entries. `x-forwarded-for`
// would not rescue that on its own: almost all real traffic is server-to-server
// from the frontend, so every logged-in user shares one source address however
// the header is read. Attributing a burst to an end client needs the trusted
// proxy-hop count from the platform team, which is an open question.
//
// The claim this evidence has to support — that nothing anywhere caps the
// request rate — holds without attributing requests to a client, so the peer
// address and the forwarded-for chain are recorded as ATTRIBUTES of a burst
// rather than used to bucket it. A reader can then see for themselves what the
// service was told about where the traffic came from.
//
// If this instead enforced a cap it would BE the fix; keeping it purely
// observational is deliberate — the spike wants to measure the problem, not
// solve it.
import { logPerf } from '../common/helpers/perf-evidence.js'

/** Sliding window over which requests are counted, in milliseconds. */
const WINDOW_MS = 10_000

/** Width of one counting bucket. `WINDOW_MS` is a whole multiple of it. */
const BUCKET_MS = 1_000

/** Number of buckets the window is divided into. */
const BUCKET_COUNT = WINDOW_MS / BUCKET_MS

/**
 * Requests per window above which the service is logged as uncapped. This is a
 * whole-service figure (300 per 10s = 30/sec), far above this service's
 * interactive load and trivially exceeded by a scripted client.
 */
const BURST_THRESHOLD = 300

/** Minimum gap between burst logs, to bound log volume under sustained load. */
const LOG_COOLDOWN_MS = 5_000

/** Paths left out of the count: the load balancer's own health probes. */
const IGNORED_PATHS = new Set(['/health'])

/**
 * Fixed ring of per-bucket counters. Counting into buckets keeps the per-request
 * work O(1) and allocation-free — this runs on every request in every
 * environment, so it must not become a cost worth measuring in its own right.
 */
function createCounter() {
  return {
    buckets: new Array(BUCKET_COUNT).fill(0),
    lastBucket: null,
    lastLoggedAt: 0
  }
}

/** Match the router's `stripTrailingSlash` so `/health/` is skipped as well. */
function normalisePath(path) {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/** Zero the buckets skipped since the last request, at most a whole window. */
function expireSkippedBuckets(counter, bucket) {
  const skipped = Math.min(bucket - counter.lastBucket, BUCKET_COUNT)
  for (let i = 1; i <= skipped; i += 1) {
    counter.buckets[(counter.lastBucket + i) % BUCKET_COUNT] = 0
  }
}

/** Record one request and return how many now sit inside the window. */
function recordRequest(counter, now) {
  const bucket = Math.floor(now / BUCKET_MS)

  if (counter.lastBucket === null) {
    counter.lastBucket = bucket
  } else if (bucket !== counter.lastBucket) {
    expireSkippedBuckets(counter, bucket)
    counter.lastBucket = bucket
  }

  counter.buckets[bucket % BUCKET_COUNT] += 1
  return counter.buckets.reduce((total, count) => total + count, 0)
}

/** Log a single evidence line while the service is over the burst threshold. */
function maybeLogBurst(server, request, counter, now, windowRequests) {
  if (
    windowRequests <= BURST_THRESHOLD ||
    now - counter.lastLoggedAt <= LOG_COOLDOWN_MS
  ) {
    return
  }
  counter.lastLoggedAt = now
  logPerf(server.logger, 'no-rate-limit', {
    windowRequests,
    windowMs: WINDOW_MS,
    path: request.path,
    method: request.method,
    // Attributes, not buckets — see the header comment. Behind the load
    // balancer `remoteAddress` is the balancer and `forwardedFor` is whatever
    // chain reached it, neither of which identifies the end client on its own.
    remoteAddress: request.info?.remoteAddress ?? 'unknown',
    forwardedFor: request.headers?.['x-forwarded-for'] ?? null
  })
}

const rateEvidence = {
  plugin: {
    name: 'rate-evidence',
    register(server) {
      const counter = createCounter()

      server.ext('onRequest', (request, h) => {
        if (IGNORED_PATHS.has(normalisePath(request.path))) {
          return h.continue
        }

        const now = Date.now()
        const windowRequests = recordRequest(counter, now)
        maybeLogBurst(server, request, counter, now, windowRequests)

        return h.continue
      })
    }
  }
}

export { rateEvidence }
