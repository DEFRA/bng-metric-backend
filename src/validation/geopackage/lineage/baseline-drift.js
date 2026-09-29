// STAGED_BASELINE_DRIFTED: has a baseline feature changed shape since its
// post-intervention children were linked to it?
//
// Every writer of a linked post-intervention row records the parent's shape
// in `parent_geom`, as WKT at 3 decimals: the template's Copy action, its
// Refresh action, its paste defaults, the converter and the generators. So
// `parent_geom` is the parent's shape at Copy, at paste, or at the last
// Refresh. When the current baseline geometry no longer matches it, the
// baseline was edited afterwards and the post-intervention rows may no longer
// describe what is there. That is a warning, never an error: the edit may be
// a legitimate correction.
//
// Pure JavaScript, no database. Which rows are checked:
//
//   * a row whose stamp resolves (parent_uuid first, then Parent Ref, the
//     order deriveLineage uses) AND that carries parent_geom is compared with
//     every baseline row of that parent. A parent split into several baseline
//     rows shares one uuid, so a match with any of them is enough;
//   * a stamped row with no parent_geom is skipped silently. Files made before
//     the column existed carry none, and there is nothing to compare;
//   * a parent_geom that cannot be read (garbage, EMPTY, a curve type) counts
//     as drift: the recorded shape cannot be the parent's current one;
//   * so does a parent_geom longer than MAX_PARENT_GEOM_CHARS. parent_geom is
//     text from the upload; the reader is linear and each distinct text is
//     read once, and the cap keeps one crafted row from holding the thread;
//   * an unstamped row, or one whose stamp resolves nowhere, is not checked
//     here. STAGED_UNKNOWN_PARENT_REF and STAGED_PARENT_INFERRED cover those.

import {
  canonicalGeometriesMatch,
  canonicalGeometry,
  canonicalGeometryFromWkt,
  canonicalGeometryStrippedFirst
} from './canonical-geometry.js'

/**
 * The longest parent_geom text that is read. A vertex at 3 decimals in British
 * National Grid takes about 25 characters, so this holds a parent of some
 * 300,000 vertices, far beyond any surveyed feature. A longer text counts as
 * drift unread.
 */
const MAX_PARENT_GEOM_CHARS = 8_000_000

function isPresent(value) {
  return value != null && value !== ''
}

/** The row's `parent_geom` text, or '' when it has none. */
function recordedParentWkt(feature) {
  const value = feature?.parentGeom
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {object[]} baseline
 * @param {string} key feature property to group by
 * @returns {Map<string, object[]>}
 */
function groupBy(baseline, key) {
  const groups = new Map()
  for (const feature of baseline) {
    const value = feature?.[key]
    if (!isPresent(value)) {
      continue
    }
    const list = groups.get(value) ?? []
    list.push(feature)
    groups.set(value, list)
  }
  return groups
}

/**
 * The baseline rows a post-intervention row is stamped with, resolved the way
 * deriveLineage resolves them: a uuid that names a baseline row wins, else a
 * Parent Ref that does. Undefined when the stamp resolves nowhere.
 *
 * @param {object} feature
 * @param {Map<string, object[]>} rowsByUuid
 * @param {Map<string, object[]>} rowsByRef
 * @returns {object[] | undefined}
 */
function stampedParentRows(feature, rowsByUuid, rowsByRef) {
  const byUuid = isPresent(feature?.parentUuid)
    ? rowsByUuid.get(feature.parentUuid)
    : undefined
  if (byUuid) {
    return byUuid
  }
  return isPresent(feature?.parentRef)
    ? rowsByRef.get(feature.parentRef)
    : undefined
}

/** `compute`, with each key's result worked out at most once. */
function memoise(compute) {
  const results = new Map()
  return (key) => {
    if (!results.has(key)) {
      results.set(key, compute(key))
    }
    return results.get(key)
  }
}

/**
 * Canonical shapes for one drift check, each worked out at most once: a
 * baseline row's current shape however many children point at it, and a
 * recorded parent_geom however many children share the same text.
 *
 * A baseline row has two canonical forms (see canonical-geometry.js): rounded
 * first, and with its vertex noise stripped at full precision first. The
 * second removes a vertex that topological editing inserted on an edge after
 * the record was made, which rounding can push more than 1 mm off the edge.
 * It is worked out only for a row the first form does not match.
 */
function createShapeCache() {
  const roundedFirst = memoise((row) => canonicalGeometry(row.geometry))
  const strippedFirst = memoise((row) =>
    canonicalGeometryStrippedFirst(row.geometry)
  )
  const recordedShape = memoise(canonicalGeometryFromWkt)

  const recorded = (wkt) =>
    wkt.length > MAX_PARENT_GEOM_CHARS ? null : recordedShape(wkt)

  const matches = (shape, row) =>
    shape !== null &&
    (canonicalGeometriesMatch(shape, roundedFirst(row)) ||
      canonicalGeometriesMatch(shape, strippedFirst(row)))

  return { recorded, matches }
}

/**
 * Post-intervention rows whose recorded parent shape (`parent_geom`) matches
 * none of the baseline rows of the parent they are stamped with. Grouped per
 * parent, so a parcel split into ten pieces reports one drift, not ten.
 *
 * @param {string} type
 * @param {object[]} postIntervention readStagedGeoPackage features with { parentUuid, parentRef, parentGeom }
 * @param {object[]} baseline readStagedGeoPackage features with { featureUuid, ref, geometry }
 * @returns {Array<{ type: string, parent_ref: string, pi_count: number }>}
 */
export function baselineDrift(type, postIntervention, baseline) {
  const rowsByUuid = groupBy(baseline, 'featureUuid')
  const rowsByRef = groupBy(baseline, 'ref')
  const shapes = createShapeCache()

  const drifted = new Map()
  for (const feature of postIntervention) {
    const recordedWkt = recordedParentWkt(feature)
    const rows = recordedWkt
      ? stampedParentRows(feature, rowsByUuid, rowsByRef)
      : undefined
    if (!rows) {
      continue
    }
    const recorded = shapes.recorded(recordedWkt)
    if (rows.some((row) => shapes.matches(recorded, row))) {
      continue
    }
    const ref = rows[0].ref ?? feature.parentUuid
    const entry = drifted.get(ref) ?? { type, parent_ref: ref, pi_count: 0 }
    entry.pi_count += 1
    drifted.set(ref, entry)
  }
  return [...drifted.values()]
}
