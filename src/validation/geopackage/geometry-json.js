/**
 * The GeoJSON string form of a decoded geometry.
 *
 * The same geometry is needed as a string by three stages of an upload —
 * validation, sizing and persist — so the GeoPackage reader stringifies each
 * one once, at decode, and carries the result alongside the geometry object as
 * a `geometryJson` field (see `decodeFeature` in read-feature-tables.js). The
 * extract functions copy that field onto the geometry rows they build, so
 * persist reads it too.
 *
 * The field is purely an in-memory, per-request cache: it is never persisted,
 * and it is only valid because nothing mutates a geometry after decode. The
 * fallback covers geometry carriers assembled outside the reader.
 *
 * @param {string | undefined} cached the carrier's `geometryJson`, if any
 * @param {object} geometry the geometry object on that carrier
 * @returns {string}
 */
export function toGeometryJson(cached, geometry) {
  return cached ?? JSON.stringify(geometry)
}
