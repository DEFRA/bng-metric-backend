/**
 * Shared geometry fixtures for the GEOS engine's unit tests.
 *
 * Deliberately the same shapes, at the same coordinates, as
 * `integration-tests/geometry-validate-baseline-layers.test.js` builds — the
 * rule-by-rule spec that was written against the PostGIS engine this one
 * replaced. Sharing the coordinates means a unit failure here and a spec failure
 * there are directly comparable.
 */

/** EPSG:27700 metres, central-London-ish. Far from the origin, inside England. */
export const X0 = 530_000
export const Y0 = 180_000
export const EDGE = 100
export const HALF = EDGE / 2

/** A square ring with its lower-left corner at (x, y). */
export function square(x = X0, y = Y0, edge = EDGE) {
  return [
    [x, y],
    [x + edge, y],
    [x + edge, y + edge],
    [x, y + edge],
    [x, y]
  ]
}

/** A bow-tie: the classic self-intersecting ring, invalid until repaired. */
export const SELF_INTERSECTING = [
  [X0, Y0],
  [X0 + EDGE, Y0 + EDGE],
  [X0 + EDGE, Y0],
  [X0, Y0 + EDGE],
  [X0, Y0]
]

function feature(geometry, properties, srid) {
  return {
    type: 'Feature',
    properties,
    nativeGeometry: geometry,
    geometryJson: JSON.stringify(geometry),
    nativeSrid: srid
  }
}

export function polygon(ring, properties = {}, srid = 27_700) {
  return feature({ type: 'Polygon', coordinates: [ring] }, properties, srid)
}

export function line(coordinates, properties = {}, srid = 27_700) {
  return feature({ type: 'LineString', coordinates }, properties, srid)
}

export function point(coordinates, properties = {}, srid = 27_700) {
  return feature({ type: 'Point', coordinates }, properties, srid)
}

/**
 * A layers object with every layer present and empty, so a test only has to
 * name the layers it cares about.
 */
export function layers(overrides = {}) {
  return {
    redline: [],
    areas: [],
    hedgerows: [],
    watercourses: [],
    iggis: [],
    trees: [],
    ...overrides
  }
}

/** The simplest file that passes every check: one parcel filling the redline. */
export function validLayers(overrides = {}) {
  return layers({
    redline: [polygon(square())],
    areas: [polygon(square(), { fid: 1, 'Parcel Ref': 'H001' })],
    ...overrides
  })
}
