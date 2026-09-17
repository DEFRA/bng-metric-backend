/**
 * The one failure type the OS tiles service throws.
 *
 * It exists to let two callers ask two different questions of the same error:
 *
 *  - the tile routes ask **"may this message be shown to the caller?"**
 *    (`upstream`). A failure this service raised about the request it was
 *    given describes that request and nothing else, so it is safe to return.
 *    A failure raised because api.os.uk said no is written for an operator —
 *    it quotes a third party whose payloads we do not control and names the
 *    configuration to change — so it belongs in the log and nowhere else.
 *  - the report builder asks **"is this the basemap failing, or the
 *    drawing?"** (`isOsTileError`). A basemap is cosmetic and a report
 *    without one is still correct, so a tile failure degrades; a fault in
 *    the renderer must not be hidden behind a substituted basemap.
 *
 * `status` is the HTTP status this failure corresponds to — OS's own for an
 * upstream failure, ours for a request we rejected. What each caller does
 * with it is the caller's business: see `clientStatusFor` in
 * `plugins/os-tiles.js`, which deliberately does not forward OS's
 * authentication statuses to a caller whose own authentication was fine.
 *
 * Mirrors `OsTileError` / `isOsTileError` in the digital prototype's
 * `app/lib/pdf-report/os-tiles.mjs`, which the report engine is shared with.
 */
class OsTileError extends Error {
  constructor(message, { status = null, upstream = false, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'OsTileError'
    this.status = status
    this.upstream = upstream
  }
}

/**
 * True for the failures a report may fall back to a plain ground on.
 *
 * Checks the name as well as the prototype chain: an error can cross a module
 * boundary that was loaded twice (vitest does this per test file), and a
 * report that 500s because `instanceof` was answered against the wrong class
 * would be the exact outage this predicate exists to prevent.
 */
function isOsTileError(error) {
  return error instanceof OsTileError || error?.name === 'OsTileError'
}

export { OsTileError, isOsTileError }
