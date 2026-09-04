#!/usr/bin/env node
/**
 * Capacity benchmarks for the in-process geometry validator.
 *
 * Three questions, because they are three different properties:
 *
 *   latency     How long does one validation take, by file size? Runs the
 *               engine inline, with no worker in the way.
 *   lag         How much does a validation block the event loop, inline versus
 *               on a worker? This is what makes the worker pool mandatory
 *               rather than an optimisation.
 *   throughput  What does sustained validation load cost the rest of the
 *               service? Drives concurrent validations through the real pool
 *               while a light pooled query loops alongside.
 *
 * Usage:
 *   node scripts/bench-geometry-validation.mjs <fixture-dir> [latency|lag|throughput|all]
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
 * The `throughput` benchmark needs a running Postgres for its probe (docker
 * compose up -d). Nothing else here touches the database — which is the point.
 *
 * A NOTE ON THE COMPARISON. The figures in docs/geometry-validation.md that put
 * this engine against the PostGIS statement it replaced were taken while both
 * existed. That statement has since been deleted, so this script no longer
 * measures it; to reproduce the comparison, check the old engine out of history
 * (see the `recordedAtCommit` in integration-tests/fixtures/
 * postgis-geometry-verdicts.json).
 *
 * READ THE NUMBERS IN CONTEXT. Absolute timings depend heavily on how much CPU
 * the box has. What is durable is the SHAPE — the loop-lag difference between
 * inline and worker, and the fact that validation load leaves the probe rate
 * untouched.
 */
import fs from 'node:fs'
import path from 'node:path'

import pg from 'pg'

// Silence the perf-evidence log lines before anything reads the config. They are
// emitted per layer and per validation, and at 5,000 parcels they bury the
// results. This has to happen before the modules below are evaluated, which is
// why they are imported dynamically: ESM hoists static imports above any
// statement here.
process.env.ENABLE_PERF_EVIDENCE = 'false'

const { readGeoPackage } =
  await import('../src/validation/geopackage/geopackage.js')
const { validateGeoPackageLayersGeos } =
  await import('../src/validation/geopackage/geos/index.js')
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

/** Measurement window for each throughput scenario, in ms. */
const DEFAULT_THROUGHPUT_WINDOW_MS = 12_000
const THROUGHPUT_WINDOW_MS = Number(
  process.env.BENCH_WINDOW_MS ?? DEFAULT_THROUGHPUT_WINDOW_MS
)

/** Concurrent validations driven during the throughput benchmark. */
const THROUGHPUT_CONCURRENCY = 12

/** Warm-up for the probe loop before the first measured window, in ms. */
const PROBE_WARMUP_MS = 3000

/** The 50th percentile, as a fraction — the argument `percentile` takes. */
const MEDIAN = 0.5

/** Default Postgres port, for the probe's pool. */
const DEFAULT_DB_PORT = 5432

/**
 * Column widths for the three result tables. Gathered here rather than left as
 * bare arguments to padStart/padEnd, where a row and its header drift apart the
 * moment either is edited.
 */
const LATENCY_COLUMNS = { file: 7, features: 8, median: 6 }
const LAG_COLUMNS = { scenario: 32, elapsed: 8, p50: 7, max: 7, ticks: 5 }
const THROUGHPUT_COLUMNS = {
  scenario: 38,
  served: 7,
  acquire: 7,
  completed: 11
}

const [, , fixtureDir, mode = 'all'] = process.argv
if (!fixtureDir) {
  console.error(
    'usage: node scripts/bench-geometry-validation.mjs <fixture-dir> [latency|lag|throughput|all]'
  )
  process.exit(1)
}

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? DEFAULT_DB_PORT),
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
  values.length
    ? [...values].sort((a, b) => a - b)[Math.trunc(values.length * p)]
    : 0

/**
 * A pool sized for the benchmark rather than for production: the queue is left
 * effectively unbounded so concurrent jobs QUEUE instead of being refused, which
 * keeps the throughput numbers about the engine rather than about admission
 * control.
 */
function benchWorkerPool() {
  return new GeosWorkerPool({
    size: 2,
    queueLimit: 1000,
    timeoutMs: 300_000
  })
}

async function benchLatency() {
  console.log('\nLatency — run inline, so no worker boundary is in the way')
  console.log(`(median of ${LATENCY_RUNS} runs)\n`)
  console.log('parcels | features |   inline | valid')

  for (const name of ['p250', 'p1000', 'p5000']) {
    const layers = readGeoPackage(fixture(name))
    const timings = []
    let result

    for (let run = 0; run < LATENCY_RUNS; run++) {
      const start = performance.now()
      result = await validateGeoPackageLayersGeos(layers)
      timings.push(performance.now() - start)
    }

    console.log(
      `${name.slice(1).padStart(LATENCY_COLUMNS.file)} | ` +
        `${String(featureCount(layers)).padStart(LATENCY_COLUMNS.features)} | ` +
        `${median(timings).toFixed(0).padStart(LATENCY_COLUMNS.median)}ms | ${result.valid}`
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
        p50: percentile(samples, MEDIAN),
        max: samples.length ? Math.max(...samples) : Number.NaN,
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
    `${name.padEnd(LAG_COLUMNS.scenario)} | ` +
      `${elapsed.toFixed(0).padStart(LAG_COLUMNS.elapsed)}ms | ` +
      `${lag.p50.toFixed(1).padStart(LAG_COLUMNS.p50)}ms | ` +
      `${lag.max.toFixed(0).padStart(LAG_COLUMNS.max)}ms | ` +
      `${String(lag.ticks).padStart(LAG_COLUMNS.ticks)}`
  )
}

async function benchLag() {
  const file = fixture('p5000')
  const layers = readGeoPackage(file)
  console.log('\nEvent-loop lag on the 5,000-parcel file\n')
  console.log(
    'scenario                         | duration | lag p50 | lag max | ticks'
  )

  await measureLag('inline on the main thread', () =>
    validateGeoPackageLayersGeos(layers)
  )

  const workers = benchWorkerPool()
  await measureLag('on a worker thread', () => workers.run(file))
  await workers.close()
}

/**
 * Stand-in for the light reads that share the connection pool with everything
 * else — a login check, a project list. Validation no longer competes with
 * these for a connection, and this is what demonstrates it.
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
    `${name.padEnd(THROUGHPUT_COLUMNS.scenario)} | ` +
      `${String(stats.served).padStart(THROUGHPUT_COLUMNS.served)} | ` +
      `${percentile(stats.acquire, MEDIAN).toFixed(0).padStart(THROUGHPUT_COLUMNS.acquire)}ms | ` +
      `${String(completed).padStart(THROUGHPUT_COLUMNS.completed)}`
  )
}

async function benchThroughput() {
  const file = fixture('p1000')
  console.log(
    `\nProbe throughput — a light pooled query in a loop for ${THROUGHPUT_WINDOW_MS / 1000}s, with`
  )
  console.log(
    `${THROUGHPUT_CONCURRENCY} concurrent validations of a 1,000-parcel file. Pool max ${POOL_MAX}, as in production.\n`
  )

  // Warm the probe loop before the first measured window. Measured cold, the
  // idle baseline comes out LOWER than the loaded run, which reads as nonsense
  // and is purely a JIT artefact.
  await probe(performance.now() + PROBE_WARMUP_MS, { served: 0, acquire: [] })

  console.log(
    'scenario                               | served  | acq p50 | validations'
  )
  await throughputScenario('idle (no validation running)', () => [])
  // Control. Twelve pending async loops doing NO geometry work at all raise the
  // probe rate above idle on their own — the loop polls harder when it has work
  // — so the validation row below has to be read against THIS, not against idle.
  await throughputScenario('12 concurrent no-op loops (control)', (deadline) =>
    spin(deadline, () => new Promise((resolve) => setImmediate(resolve)))
  )

  const workers = benchWorkerPool()
  console.log(`  (worker pool resolved to ${workers.size} worker(s))`)
  await throughputScenario('12 concurrent validations', (deadline) =>
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
