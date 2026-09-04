/**
 * Admission control for the GeoPackage unpack.
 *
 * HISTORY MATTERS HERE, because it changes what this is for. Originally the
 * route unpacked every shape at the TOP of the handler, before the worker pool
 * was consulted, so a request the pool was about to refuse had already paid for
 * its own copy of every feature — and held it for the whole queue wait. Eight
 * queued 12,000-parcel uploads pinned ~514 MB that way. This module was written
 * to refuse such a file from its SIZE before any of that was paid.
 *
 * The route no longer works that way. The format gate now runs WITHOUT
 * unpacking, and the shapes are read on the far side of the pool wait, so a
 * queued request holds a file path rather than an object graph — the same eight
 * uploads now hold ~53 MB between them.
 *
 * So this is no longer the main defence, and it should not be described as one.
 * What it still does is bound how many uploads can be unpacked CONCURRENTLY
 * once past the pool, which the worker count alone does not: a request holds
 * its layers through the data-quality checks and persistence, both of which
 * happen after the geometry verdict. That is a real but much smaller window.
 *
 * Measured cost of unpacking one file:
 *
 *   80 parcels     (140 KB)     6 MB
 *   800 parcels    (704 KB)    16 MB
 *   5,000 parcels  (4.0 MB)    48 MB
 *   12,000 parcels (9.5 MB)   131 MB
 *
 * Refusing here is still free, and the caller already knows what to do with the
 * answer — it is the same 503 with Retry-After a full queue gives.
 */

/**
 * Fixed cost of parsing any GeoPackage, however small — the sqlite handle, the
 * layer scaffolding and the per-layer GeoJSON wrappers. Taken from the 80-parcel
 * fixture, which costs 6 MB for 140 KB of file.
 */
const PARSE_FIXED_BYTES = 8 * 1024 * 1024

/**
 * Parsed bytes per byte of file, above {@link PARSE_FIXED_BYTES}.
 *
 * Deliberately rounded UP from the measurements (the steepest real ratio is
 * 13.3, on the 12,000-parcel fixture): an admission check that under-estimates
 * admits a file it cannot afford, which is the failure this module exists to
 * prevent. Over-estimating only costs throughput, and says so in the metric.
 */
const PARSE_BYTES_PER_FILE_BYTE = 14

/**
 * Estimated heap cost of parsing a file of this size.
 *
 * @param {number|null|undefined} fileSizeBytes as reported by the uploader
 * @returns {number} bytes to reserve
 */
export function estimateParsedBytes(fileSizeBytes) {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    // The uploader did not tell us how big the file is, so there is nothing to
    // size a reservation from. Charge the fixed cost and let the pool's queue
    // limit stay the backstop, rather than inventing a number that would either
    // refuse everything or protect nothing.
    return PARSE_FIXED_BYTES
  }
  return PARSE_FIXED_BYTES + fileSizeBytes * PARSE_BYTES_PER_FILE_BYTE
}

/** Thrown when a file cannot be admitted without exceeding the budget. */
export class ParseBudgetExceededError extends Error {
  /**
   * @param {number} wantedBytes
   * @param {number} inFlightBytes
   * @param {number} limitBytes
   */
  constructor(wantedBytes, inFlightBytes, limitBytes) {
    super(
      `Parsing this file needs ~${Math.round(wantedBytes / 1024 / 1024)} MB and ` +
        `${Math.round(inFlightBytes / 1024 / 1024)} MB of the ` +
        `${Math.round(limitBytes / 1024 / 1024)} MB parse budget is already in flight`
    )
    this.name = 'ParseBudgetExceededError'
    this.wantedBytes = wantedBytes
    this.inFlightBytes = inFlightBytes
    this.limitBytes = limitBytes
  }
}

/**
 * Tracks how many bytes of parsed GeoPackage are currently on the heap.
 *
 * Counting reservations rather than sampling RSS is deliberate: RSS lags, and
 * it never falls back to where it started (V8 keeps its heap reserved and glibc
 * keeps its arenas), so a limit read off RSS tightens as the process ages. What
 * this needs to know is how much work is in flight right now, which is exactly
 * what the route can tell it.
 */
export class ParseBudget {
  /** @param {number} limitBytes */
  constructor(limitBytes) {
    this.limitBytes = limitBytes
    this.inFlightBytes = 0
  }

  /**
   * Would a file of this size fit right now?
   *
   * Advisory, not a reservation — the answer can be stale by the time
   * {@link reserve} is called, which is why `reserve` re-checks. Same contract
   * as the pool's `hasCapacity`, and used in the same place: to refuse before
   * streaming a file out of S3 that is only going to be turned away.
   *
   * @param {number|null|undefined} fileSizeBytes
   */
  hasRoomFor(fileSizeBytes) {
    return this.wouldFit(estimateParsedBytes(fileSizeBytes))
  }

  /**
   * Always admit a file when nothing else is in flight, however large it is.
   * A single upload that cannot fit the budget must still be allowed to try —
   * refusing it would mean the file could never be validated at all, which is a
   * permanent failure dressed up as back-pressure. The pool's own timeout is
   * what catches a file too big to handle.
   *
   * @param {number} wantedBytes
   */
  wouldFit(wantedBytes) {
    if (this.inFlightBytes === 0) {
      return true
    }
    return this.inFlightBytes + wantedBytes <= this.limitBytes
  }

  /**
   * Reserve room for one parse.
   *
   * @param {number|null|undefined} fileSizeBytes
   * @returns {() => void} releases the reservation; safe to call more than once
   * @throws {ParseBudgetExceededError} when the budget is already committed
   */
  reserve(fileSizeBytes) {
    const wantedBytes = estimateParsedBytes(fileSizeBytes)
    if (!this.wouldFit(wantedBytes)) {
      throw new ParseBudgetExceededError(
        wantedBytes,
        this.inFlightBytes,
        this.limitBytes
      )
    }
    this.inFlightBytes += wantedBytes
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.inFlightBytes -= wantedBytes
    }
  }
}

/** @type {ParseBudget|null} */
let budget = null

/**
 * The process-wide budget. One per process, because the thing being rationed —
 * this process's heap — is process-wide.
 *
 * @param {number} limitBytes
 * @returns {ParseBudget}
 */
export function getParseBudget(limitBytes) {
  budget ??= new ParseBudget(limitBytes)
  return budget
}

/** Drop the shared budget, so a test can start from a known state. */
export function resetParseBudget() {
  budget = null
}
