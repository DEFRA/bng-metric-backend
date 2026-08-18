// Canonical geometry checksum — the cross-language contract with the QGIS
// template's copy action (see the workspace note
// `lineage-uuid-reconciliation.md`). The template stamps
// `parent_checksum` = checksum(parent geometry) at copy time; this module must
// reproduce that value byte-for-byte from the geometry the backend reads, so
// a mismatch means the baseline genuinely changed after the copy.
//
// Recipe (identical in the template's Python):
//
//   canonical = TYPE_UPPERCASE + "|" + ser(coordinates)
//     ser(leaf position) = numbers formatted to 3 decimals, joined ","
//     ser(nested array)  = "(" + children joined ";" + ")"
//   checksum = first 16 hex chars of sha256(canonical)
//
// 3 decimals = millimetres in EPSG:27700, so representation noise between the
// two GeoJSON serialisers cannot manufacture a false drift. Rounding-tie
// divergence between Python's %.3f (half-even) and toFixed (half-away) needs
// an exact binary midpoint and real survey coordinates never sit on one; the
// worst case is a spurious warning, never an error.

import { createHash } from 'node:crypto'

const COORD_DECIMALS = 3
const CHECKSUM_HEX_LENGTH = 16

function serialise(node) {
  if (typeof node[0] === 'number') {
    return node.map((value) => value.toFixed(COORD_DECIMALS)).join(',')
  }
  return `(${node.map((child) => serialise(child)).join(';')})`
}

/**
 * Checksum of a GeoJSON geometry, or null when there is nothing to hash.
 *
 * @param {{ type: string, coordinates: unknown[] } | null | undefined} geometry
 * @returns {string | null}
 */
export function geometryChecksum(geometry) {
  if (!geometry?.type || !Array.isArray(geometry.coordinates)) {
    return null
  }
  const payload = `${geometry.type.toUpperCase()}|${serialise(geometry.coordinates)}`
  return createHash('sha256')
    .update(payload, 'utf8')
    .digest('hex')
    .slice(0, CHECKSUM_HEX_LENGTH)
}
