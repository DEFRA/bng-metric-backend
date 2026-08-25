// Lightweight, always-on structured logging used to gather EVIDENCE for the
// performance issues catalogued in the "System Performance Issues" spike. Each
// call emits a single structured pino line carrying a stable `perfEvidence`
// marker (the spike issue id) plus measured fields — durations in ms, byte
// sizes, feature/row counts, memory deltas — so the evidence can be pulled from
// the logs with `grep perfEvidence` or filtered in ECS on `perfEvidence:<id>`.
//
// This is instrumentation, NOT a fix: it records how bad each issue gets, it
// does not change behaviour. Kept in one place so the marker and field shape
// stay consistent across every instrumented site.
//
// Log lines are for INVESTIGATION (high-cardinality detail: uploadId, table
// names, per-call timings, searchable in the logs UI). They are not charted.
// The aggregate view lives in CloudWatch/Grafana and is emitted separately via
// src/common/helpers/metrics.js — see the note in metric-names.js for which
// measurements are promoted to a metric and why the two are kept apart.

/** Field name every evidence line carries, set to the spike issue id. */
const PERF_EVIDENCE_MARKER = 'perfEvidence'

/** Bytes in a megabyte, for reporting memory usage in whole MB. */
const BYTES_PER_MB = 1024 * 1024

/** Microseconds in a millisecond, for sub-millisecond measurements. */
const MICROS_PER_MS = 1000

/**
 * High-resolution millisecond clock for measuring elapsed time. Returned values
 * are only meaningful as differences (see {@link msSince}).
 *
 * @returns {number}
 */
function perfNow() {
  return performance.now()
}

/**
 * Whole milliseconds elapsed since a {@link perfNow} reading.
 *
 * @param {number} start
 * @returns {number}
 */
function msSince(start) {
  return Math.round(perfNow() - start)
}

/**
 * Whole microseconds elapsed since a {@link perfNow} reading, for work that
 * completes in well under a millisecond (the reference-data rebuilds).
 *
 * @param {number} start
 * @returns {number}
 */
function microsSince(start) {
  return Math.round((perfNow() - start) * MICROS_PER_MS)
}

/**
 * Process memory in whole megabytes, as four separate figures.
 *
 * `heapUsed` on its own is the WRONG measure for anything holding a Buffer:
 * Node allocates Buffer bytes OUTSIDE the V8 heap, in the external/ArrayBuffer
 * pool. A 100 MB S3 download therefore moves `rss`, `external` and
 * `arrayBuffers` while leaving `heapUsed` almost flat — reporting only the heap
 * delta made a large download look free, which is the opposite of the evidence
 * the download site is there to capture. `rss` is the number that matters for
 * an ECS task hitting its memory limit; the others say where it went.
 *
 * @returns {{ rssMb: number, heapUsedMb: number, externalMb: number, arrayBuffersMb: number }}
 */
function memoryUsageMb() {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage()
  return {
    rssMb: Math.round(rss / BYTES_PER_MB),
    heapUsedMb: Math.round(heapUsed / BYTES_PER_MB),
    externalMb: Math.round(external / BYTES_PER_MB),
    arrayBuffersMb: Math.round(arrayBuffers / BYTES_PER_MB)
  }
}

/**
 * Total UTF-8 byte length of a string.
 *
 * @param {string} value
 * @returns {number}
 */
function utf8Bytes(value) {
  return Buffer.byteLength(value)
}

/**
 * Emit one structured evidence line. `logger` is any pino-like logger exposing
 * `.info(obj, msg)` — a route's `request.logger`, `server.logger`, or a
 * module-level `createLogger()`. No-ops safely when no such logger is in scope
 * (e.g. the enrich path's NO_OP_LOGGER), so callers never have to guard.
 *
 * Never throws. Evidence is now emitted from the login transaction, every
 * upload stage, the project-list query and the reference-data getters, so a
 * throwing logger would fail — or in the login case roll back — a request that
 * was only recording a measurement. Same policy as withMetrics in metrics.js:
 * instrumentation must never break the work it observes.
 *
 * Note this guards the EMIT, not the arguments: anything the caller computes to
 * build `fields` is evaluated before this function is entered, so a throw there
 * still propagates. withMetrics has the same boundary.
 *
 * @param {{ info?: Function } | undefined} logger
 * @param {string} id spike issue id, e.g. 'pipeline-inline'
 * @param {object} [fields] measured values to attach
 */
function logPerf(logger, id, fields = {}) {
  if (!logger?.info) {
    return
  }
  try {
    logger.info(
      { [PERF_EVIDENCE_MARKER]: id, ...fields },
      `perf-evidence: ${id}`
    )
  } catch {
    // The logger itself is what failed, so there is nowhere to report it —
    // reporting a logging failure through logging is circular, and a fresh
    // logger would share the broken transport. Drop the evidence instead:
    // losing a measurement is always preferable to failing the request.
  }
}

export {
  logPerf,
  perfNow,
  msSince,
  microsSince,
  memoryUsageMb,
  utf8Bytes,
  PERF_EVIDENCE_MARKER,
  BYTES_PER_MB
}
