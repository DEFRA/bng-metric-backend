/**
 * Admission control for the GeoPackage unpack.
 *
 * No longer the main defence, and should not be described as one. It was written
 * when the route unpacked every shape at the top of the handler, before the
 * worker pool was consulted, so a request the pool was about to refuse had
 * already paid for a copy of every feature and held it for the whole queue wait
 * — eight queued 12,000-parcel uploads pinned ~514 MB. The format gate now runs
 * without unpacking and the shapes are read on the far side of the pool wait, so
 * those same eight hold ~53 MB between them.
 *
 * What it still does is bound how many uploads are unpacked CONCURRENTLY once
 * past the pool, which the worker count alone does not: a request holds its
 * layers through the data-quality checks and persistence, both of which happen
 * after the geometry verdict.
 *
 * The estimate therefore charges the cost of one MORE concurrent unpack, not of
 * the first — a single read pays for process growth the second and third do not
 * pay again. Measured holding N uploads alive at once, each N in a fresh process
 * (RSS never comes back down, so successive runs in one process would each start
 * from an inflated baseline):
 *
 *   file        N=1 RSS   N=8 RSS/upload   retained heap/upload
 *   140 KB         7 MB           1.8 MB                 0.5 MB
 *   704 KB        15 MB           6.9 MB                 2.8 MB
 *   4.0 MB        56 MB          34.1 MB                16.2 MB
 *   9.3 MB       109 MB          58.1 MB                38.6 MB
 *
 * Refusing here is free, and the caller already knows what to do with the answer
 * — the same 503 with Retry-After a full queue gives.
 */

/**
 * Fixed cost of parsing any GeoPackage, however small — the sqlite handle, the
 * layer scaffolding and the per-layer GeoJSON wrappers. Small because it is the
 * cost of one more concurrent parse: 1.8 MB per upload at N=8 for the 140 KB
 * fixture, against 7 MB read alone. It exists at all because per-MB cost falls
 * as files grow, so the fit needs an intercept.
 */
const PARSE_FIXED_BYTES = 2 * 1024 * 1024

/**
 * Parsed bytes per byte of file, above {@link PARSE_FIXED_BYTES}.
 *
 * Rounded UP from the N=8 column, because an under-estimate admits a file the
 * heap cannot afford while an over-estimate only costs throughput and says so in
 * the metric. 2 MB + 10x is the tightest pair that clears every fixture by no
 * more than the factor of two the tests allow: 1.9x on the smallest, 1.2x at
 * 4 MB, 1.6x on the largest. A fixed term plus a slope is needed because per-MB
 * cost falls with size — 12.8x down to 6.3x across the four.
 *
 * The previous 8 MB + 14x was fitted to the N=1 column, charging every upload
 * the process growth only the first causes: at 550 MB of budget it admitted
 * three 9.3 MB uploads where the memory was there for five.
 */
const PARSE_BYTES_PER_FILE_BYTE = 10

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
