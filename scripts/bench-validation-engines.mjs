#!/usr/bin/env node
/**
 * The benchmarks behind the tables in docs/geometry-validation-engines.md.
 *
 * Three questions, because they are three different claims and only one of them
 * is about speed:
 *
 *   latency     How long does each engine take on the same file? Runs GEOS
 *               inline, so it is engine against engine with no worker in the
 *               way. Also re-checks that the two still agree at a scale well
 *               past anything in example-files/.
 *   lag         How much does each engine block the event loop? This is the one
 *               that decides whether worker threads are optional.
 *   throughput  How much of the service's capacity does validation consume
 *               while it runs? This is the reason the GEOS engine exists.
 *
 * Usage:
 *   node scripts/bench-validation-engines.mjs <fixture-dir> [latency|lag|throughput|all]
 *
 * BENCH_WINDOW_MS shortens each throughput scenario (default 12000).
 *
 * <fixture-dir> holds p250/, p1000/ and p5000/ subdirectories, each with one
 * .gpkg. Generate them from the harness:
 *
 *   for n in 250 1000 5000; do
 *     node scripts/gen-gpkg.mjs --size $n --seed 1 --outdir <fixture-dir>/p$n
 *   done
 *
 * Needs a running PostGIS (docker compose up -d in this repo).
 *
 * READ THE NUMBERS IN CONTEXT. The ratios depend heavily on how much CPU the
 * database has relative to Node; on a small box with PostgreSQL co-resident the
 * SQL side is starved and the comparison flatters GEOS. What is durable here is
 * the SHAPE of the throughput collapse and of the loop-lag difference, not the
 * multiple.
 */
import fs from 'node:fs'
import path from 'node:path'

import pg from 'pg'

// Silence the perf-evidence log lines before anything reads the config. They are
// emitted per layer and per query, and at 5,000 parcels they bury the results.
// This has to happen before the modules below are evaluated, which is why they
// are imported dynamically: ESM hoists static imports above any statement here.
process.env.ENABLE_PERF_EVIDENCE = 'false'

const { readGeoPackage } =
  await import('../src/validation/geopackage/geopackage.js')
const { validateGeoPackageLayersGeos } =
  await import('../src/validation/geopackage/geos/index.js')
const { validateGeoPackageLayersPostgis } =
  await import('../src/validation/geopackage/postgis/index.js')
const { GeosWorkerPool } =
  await import('../src/validation/geopackage/geos/worker-pool.js')

const LAYER_KEYS = [
  'redline',
  'areas',
  'hedgerows',
  'watercourses',
  'iggis',
  'trees'
]

/** Pool size the app plugin uses — src/plugins/postgres.js. */
const POOL_MAX = 10

/** Runs per size in the latency benchmark; the median is reported. */
const LATENCY_RUNS = 5

/** Interval the lag meter tries to hold, in ms. */
const LAG_INTERVAL_MS = 10

/** Ticks to wait before stopping the lag meter — see {@link lagMeter}. */
const LAG_SETTLE_TICKS = 4

/**
 * Measurement window for each throughput scenario, in ms. Overridable so a
 * quick sanity run can be done in well under a minute — the collapse it
 * measures is stark enough to show up in a few seconds, and the default is
 * only there to average out more noise.
 */
const THROUGHPUT_WINDOW_MS = Number(process.env.BENCH_WINDOW_MS ?? 12_000)

/** Concurrent validations driven during the throughput benchmark. */
const THROUGHPUT_CONCURRENCY = 12

/** Warm-up for the probe loop before the first measured window, in ms. */
const PROBE_WARMUP_MS = 3000

const [, , fixtureDir, mode = 'all'] = process.argv
if (!fixtureDir) {
  console.error(
    'usage: node scripts/bench-validation-engines.mjs <fixture-dir> [latency|lag|throughput|all]'
  )
  process.exit(1)
}

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'dev',
  password: process.env.DB_LOCAL_PASSWORD ?? 'dev',
  database: process.env.DB_DATABASE ?? 'bng_metric_backend',
  max: POOL_MAX
})

/** The single .gpkg inside <fixtureDir>/<name>. */
function fixture(name) {
  const dir = path.join(fixtureDir, name)
  const file = fs.readdirSync(dir).find((entry) => entry.endsWith('.gpkg'))
  return path.join(dir, file)
}

function featureCount(layers) {
  return LAYER_KEYS.reduce(
    (total, key) => total + (layers[key]?.length ?? 0),
    0
  )
}

const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1]

const percentile = (values, p) =>
  values.length ? [...values].sort((a, b) => a - b)[(values.length * p) | 0] : 0

/**
 * Comparable form of a verdict — codes and counts only. Enough to catch the two
 * engines disagreeing at a size no fixture covers; the exhaustive payload
 * comparison lives in integration-tests/validation-engine-parity.test.js.
 */
function verdictShape(result) {
  return JSON.stringify({
    valid: result.valid,
    codes: result.errors.map((error) => error.code),
    counts: result.errors.map((error) => error.details?.count ?? null)
  })
}

async function benchLatency() {
  console.log('\nLatency — GEOS run inline, so it is engine against engine')
  console.log(`(median of ${LATENCY_RUNS} runs)\n`)
  console.log('parcels | features |   PostGIS |    GEOS | ratio | verdicts')

  for (const name of ['p250', 'p1000', 'p5000']) {
    const layers = readGeoPackage(fixture(name))
    const postgisMs = []
    const geosMs = []
    let postgisResult
    let geosResult

    for (let run = 0; run < LATENCY_RUNS; run++) {
      let start = performance.now()
      postgisResult = await validateGeoPackageLayersPostgis(pool, layers)
      postgisMs.push(performance.now() - start)
      start = performance.now()
      geosResult = await validateGeoPackageLayersGeos(layers)
      geosMs.push(performance.now() - start)
    }

    const postgis = median(postgisMs)
    const geos = median(geosMs)
    const agree =
      verdictShape(postgisResult) === verdictShape(geosResult)
        ? 'identical'
        : 'DIFFER'
    console.log(
      `${name.slice(1).padStart(7)} | ${String(featureCount(layers)).padStart(8)} | ` +
        `${postgis.toFixed(0).padStart(7)}ms | ${geos.toFixed(0).padStart(5)}ms | ` +
        `${(geos / postgis).toFixed(2).padStart(5)} | ${agree}`
    )
  }
}

/**
 * Sample how late a fixed interval actually fires.
 *
 * A run that BLOCKS the loop only records its lag on the first tick after the
 * block ends, so `stop` waits for that tick before reading the samples —
 * stopping in the same microtask would discard it and report the worst case as
 * the best one. The tick COUNT is the real tell: far below the expected number
 * means the loop was not getting turns.
 */
function lagMeter() {
  const samples = []
  let previous = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    samples.push(Math.max(0, now - previous - LAG_INTERVAL_MS))
    previous = now
  }, LAG_INTERVAL_MS)

  return {
    async stop() {
      await new Promise((resolve) =>
        setTimeout(resolve, LAG_INTERVAL_MS * LAG_SETTLE_TICKS)
      )
      clearInterval(timer)
      return {
        p50: percentile(samples, 0.5),
        max: samples.length ? Math.max(...samples) : NaN,
        ticks: samples.length
      }
    }
  }
}

async function measureLag(name, run) {
  await run()
  const meter = lagMeter()
  const start = performance.now()
  await run()
  const elapsed = performance.now() - start
  const lag = await meter.stop()
  console.log(
    `${name.padEnd(32)} | ${elapsed.toFixed(0).padStart(8)}ms | ` +
      `${lag.p50.toFixed(1).padStart(7)}ms | ${lag.max.toFixed(0).padStart(7)}ms | ` +
      `${String(lag.ticks).padStart(5)}`
  )
}

async function benchLag() {
  const file = fixture('p5000')
  const layers = readGeoPackage(file)
  console.log('\nEvent-loop lag on the 5,000-parcel file\n')
  console.log(
    'scenario                         | duration | lag p50 | lag max | ticks'
  )

  await measureLag('PostGIS (awaited query)', () =>
    validateGeoPackageLayersPostgis(pool, layers)
  )
  await measureLag('GEOS inline on the main thread', () =>
    validateGeoPackageLayersGeos(layers)
  )

  const workers = benchWorkerPool()
  await measureLag('GEOS on a worker thread', () => workers.run(file))
  await workers.close()
}

/**
 * A pool sized for the benchmark rather than for production: the queue is left
 * effectively unbounded so concurrent jobs QUEUE instead of being refused, which
 * is what makes the throughput numbers about the engine rather than about
 * admission control.
 */
function benchWorkerPool() {
  return new GeosWorkerPool({
    size: 2,
    queueLimit: 1000,
    timeoutMs: 300_000
  })
}

/**
 * Stand-in for the light reads that share this pool with validation — a login
 * check, a project list. What matters is that it needs a CONNECTION.
 */
async function probe(deadline, stats) {
  while (performance.now() < deadline) {
    const start = performance.now()
    const client = await pool.connect()
    stats.acquire.push(performance.now() - start)
    try {
      await client.query('SELECT 1')
    } finally {
      client.release()
    }
    stats.served++
  }
}

const spin = (deadline, run) =>
  Array.from({ length: THROUGHPUT_CONCURRENCY }, async () => {
    let completed = 0
    while (performance.now() < deadline) {
      await run()
      completed++
    }
    return completed
  })

async function throughputScenario(name, startLoad) {
  const deadline = performance.now() + THROUGHPUT_WINDOW_MS
  const stats = { served: 0, acquire: [] }
  const load = startLoad(deadline)
  await probe(deadline, stats)
  const completed = (await Promise.all(load)).reduce((total, n) => total + n, 0)
  console.log(
    `${name.padEnd(38)} | ${String(stats.served).padStart(7)} | ` +
      `${percentile(stats.acquire, 0.5).toFixed(0).padStart(7)}ms | ` +
      `${String(completed).padStart(11)}`
  )
}

async function benchThroughput() {
  const file = fixture('p1000')
  const layers = readGeoPackage(file)
  console.log(
    `\nProbe throughput — a light pooled query in a loop for ${THROUGHPUT_WINDOW_MS / 1000}s, with`
  )
  console.log(
    `${THROUGHPUT_CONCURRENCY} concurrent validations of a 1,000-parcel file. Pool max ${POOL_MAX}, as in production.\n`
  )

  // Warm the probe loop before the first measured window. Measured cold, the
  // idle baseline comes out LOWER than the loaded GEOS run, which reads as
  // nonsense and is purely a JIT artefact.
  await probe(performance.now() + PROBE_WARMUP_MS, { served: 0, acquire: [] })

  console.log(
    'scenario                               | served  | acq p50 | validations'
  )
  await throughputScenario('idle (no validation running)', () => [])
  await throughputScenario('12 concurrent validations, PostGIS', (deadline) =>
    spin(deadline, () => validateGeoPackageLayersPostgis(pool, layers))
  )
  // Control. Twelve pending async loops doing NO geometry work at all raise the
  // probe rate well above idle on their own — the loop polls harder when it has
  // work — so the GEOS row below has to be read against THIS, not against idle.
  await throughputScenario('12 concurrent no-op loops (control)', (deadline) =>
    spin(deadline, () => new Promise((resolve) => setImmediate(resolve)))
  )

  const workers = benchWorkerPool()
  console.log(`  (worker pool resolved to ${workers.size} worker(s))`)
  await throughputScenario('12 concurrent validations, GEOS', (deadline) =>
    spin(deadline, () => workers.run(file))
  )
  await workers.close()

  // Idle again, last, so the baseline is bracketed rather than taken on trust.
  await throughputScenario('idle again (control)', () => [])
}

const BENCHMARKS = {
  latency: benchLatency,
  lag: benchLag,
  throughput: benchThroughput
}

try {
  for (const [name, run] of Object.entries(BENCHMARKS)) {
    if (mode === 'all' || mode === name) {
      await run()
    }
  }
} finally {
  await pool.end()
}
