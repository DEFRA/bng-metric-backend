/**
 * Shadow mode: run both engines, return the PostGIS answer, report the
 * difference.
 *
 * This is the step that actually retires the risks the spike could only measure
 * in a lab. Thirteen fixtures agreeing, and a hundred example files agreeing, is
 * evidence — but it is evidence about the files someone thought to create. Real
 * uploads carry coordinate systems, digitising habits and broken geometry that
 * nobody wrote a fixture for, and shadow mode is how those get compared without
 * a user ever seeing the new engine's answer.
 *
 * Divergences are reported two ways, for the two different questions:
 *
 *  - a structured LOG line per divergence, carrying the upload id and the two
 *    answers, so one disagreement can be investigated;
 *  - a COUNTER with a three-valued `kind` dimension, so a dashboard can show
 *    the rate and the rollout can be gated on it reaching zero.
 *
 * The three kinds are ranked by how much they matter:
 *
 *  - `codes`   — the engines disagree about whether the file is acceptable, or
 *                about why. This is the one that must be zero before the
 *                default is flipped.
 *  - `payload` — same verdict, different detail: a different count, a different
 *                feature named, a different measured area.
 *  - `wkt`     — same verdict, same detail, different rendering of the same
 *                shape. Known and expected: the two libraries can start an
 *                identical ring at different vertices. Cosmetic, affecting only
 *                the tail of an error message.
 */

/** Payload fields holding a WKT rendering rather than a measurement. */
const WKT_FIELDS = new Set(['location_wkt', 'escape_location_wkt'])

/**
 * Any WKT geometry literal. Used to blank WKT out of the rendered `message` as
 * well as out of the payload fields it came from — the error builders
 * interpolate it into the text, so leaving it there would report every
 * rendering difference as a payload difference and hide the distinction the
 * `kind` dimension exists to draw.
 *
 * Coordinates only ever contain digits, signs, exponents, dots, commas, spaces
 * and brackets, so the character class cannot run past the end of the literal.
 */
const WKT_LITERAL =
  /\b(?:POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*(?:EMPTY|\([-\d.eE+,() ]*\))/g

/** Field carrying the user-facing message the error builders assembled. */
const MESSAGE_FIELD = 'message'

/** Round measurements to a micron / square micron before comparing. */
const COMPARISON_DECIMAL_PLACES = 6

/**
 * Kinds of divergence, in descending order of how much they matter. Values are
 * the `kind` metric dimension, so they stay short and low-cardinality.
 */
export const DIVERGENCE_KIND = Object.freeze({
  codes: 'codes',
  payload: 'payload',
  wkt: 'wkt'
})

/**
 * A comparable form of one engine's result: object key order dropped (PostgreSQL
 * returns jsonb keys in its own order, JS preserves insertion order), floats
 * rounded, and — when `withWkt` is false — every WKT string replaced by a
 * placeholder so a rendering difference does not mask, or masquerade as, a
 * difference in the verdict.
 */
function canonicalise(value, { withWkt }, key) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalise(item, { withWkt }))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((name) => [name, canonicalise(value[name], { withWkt }, name)])
    )
  }
  if (typeof value === 'number') {
    return Number(value.toFixed(COMPARISON_DECIMAL_PLACES))
  }
  if (!withWkt && typeof value === 'string') {
    if (WKT_FIELDS.has(key)) {
      return '<wkt>'
    }
    if (key === MESSAGE_FIELD) {
      return value.replaceAll(WKT_LITERAL, '<wkt>')
    }
  }
  return value
}

/**
 * The parts of a result worth comparing. `message` is included deliberately:
 * it is what the user actually reads, and it is assembled from the payload by
 * the shared error builders, so a difference there is a real difference even
 * when both payloads look plausible.
 */
function comparable(result, options) {
  return canonicalise(
    {
      valid: result.valid,
      errors: result.errors.map((error) => ({
        code: error.code,
        message: error.message,
        details: error.details ?? null
      }))
    },
    options
  )
}

/**
 * Compare two engines' results.
 *
 * @param {{ valid: boolean, errors: object[] }} postgis
 * @param {{ valid: boolean, errors: object[] }} geos
 * @returns {{ diverged: boolean, kind?: string, postgisCodes: string[], geosCodes: string[] }}
 */
export function compareEngineResults(postgis, geos) {
  const postgisCodes = postgis.errors.map((error) => error.code)
  const geosCodes = geos.errors.map((error) => error.code)

  const withWkt = { withWkt: true }
  if (
    JSON.stringify(comparable(postgis, withWkt)) ===
    JSON.stringify(comparable(geos, withWkt))
  ) {
    return { diverged: false, postgisCodes, geosCodes }
  }

  if (
    postgis.valid !== geos.valid ||
    JSON.stringify(postgisCodes) !== JSON.stringify(geosCodes)
  ) {
    return {
      diverged: true,
      kind: DIVERGENCE_KIND.codes,
      postgisCodes,
      geosCodes
    }
  }

  const withoutWkt = { withWkt: false }
  const kind =
    JSON.stringify(comparable(postgis, withoutWkt)) ===
    JSON.stringify(comparable(geos, withoutWkt))
      ? DIVERGENCE_KIND.wkt
      : DIVERGENCE_KIND.payload

  return { diverged: true, kind, postgisCodes, geosCodes }
}

/**
 * The detail to attach to a divergence log line. Kept to the two error lists
 * rather than the whole payloads: enough to see what disagreed and go and
 * reproduce it, without writing a megabyte of samples into the logs on a file
 * with thousands of offenders.
 *
 * @param {{ valid: boolean, errors: object[] }} postgis
 * @param {{ valid: boolean, errors: object[] }} geos
 */
export function divergenceDetail(postgis, geos) {
  const summarise = (result) =>
    result.errors.map((error) => ({
      code: error.code,
      count: error.details?.count ?? null,
      message: error.message
    }))
  return {
    postgisValid: postgis.valid,
    geosValid: geos.valid,
    postgisErrors: summarise(postgis),
    geosErrors: summarise(geos)
  }
}
