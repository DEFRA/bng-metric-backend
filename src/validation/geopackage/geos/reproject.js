/**
 * EPSG:4326 -> EPSG:27700 reprojection for the in-process engine.
 *
 * PostGIS does this with `ST_Transform` inside the validation statement. With
 * the geometry work moved into Node there is no PostGIS in the loop, so the
 * same transform has to happen here, with proj4js.
 *
 * How close is it? Measured against PostGIS across eight sites spanning
 * England, the worst-case disagreement was 0.00075 m — roughly 130x inside the
 * tightest tolerance the validator applies (0.1 m for boundary grazing) and
 * irrelevant against the 0.5 sq m area tolerances. Evidence lives in the spike
 * at `evidence/proj4-vs-postgis.txt`.
 *
 * WHY THE DEFINITION IS PINNED HERE RATHER THAN LOOKED UP
 *
 * The accurate WGS84 -> British National Grid transformation uses the OSTN15
 * grid shift; the fallback is a 7-parameter Helmert approximation, and the two
 * differ by up to ~2 m. Several published EPSG:27700 definitions omit the
 * `+towgs84` parameters altogether, and one of those is wrong by *hundreds* of
 * metres. So the definition is written out in full below and asserted in a unit
 * test rather than taken from proj4's defaults or from a lookup service.
 *
 * The Helmert parameters here are what the tested PostGIS image also uses: it
 * has no OSTN15 grid installed (`/usr/share/proj` holds no `.tif` files and
 * `NETWORK_ENABLED=OFF`), so PROJ falls back to the same Helmert transform.
 * If production PostGIS *does* have the grid, it is currently more accurate
 * than this path and 4326 verdicts could shift by up to ~2 m — the fix then is
 * to supply proj4js with the same grid, not to abandon the approach. See the
 * open question in the implementation plan.
 */
import proj4 from 'proj4'

import { EPSG_BNG, EPSG_WGS84 } from '../geopackage-constants.js'

/**
 * EPSG:27700 (OSGB36 / British National Grid) with the 7-parameter Helmert
 * shift to WGS84. Pinned verbatim — see the module comment for why.
 */
export const EPSG_27700_DEFINITION =
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
  '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 ' +
  '+units=m +no_defs'

/** EPSG:4326 as proj4 names it — the source CRS for WGS84 uploads. */
const WGS84 = 'EPSG:4326'

/** EPSG:27700 as proj4 names it once registered below. */
const BNG = 'EPSG:27700'

proj4.defs(BNG, EPSG_27700_DEFINITION)

/** Transform one [lon, lat] pair to [easting, northing]. */
const project = (position) => {
  const [x, y] = proj4(WGS84, BNG, [position[0], position[1]])
  return [x, y]
}

/**
 * Recursively rebuild a GeoJSON coordinate structure with every position
 * projected. Depth is unknown (Point -> position, Polygon -> ring array,
 * MultiPolygon -> array of ring arrays), so it recurses on shape rather than on
 * a declared geometry type.
 *
 * @param {Array} coordinates
 * @returns {Array}
 */
function projectCoordinates(coordinates) {
  if (typeof coordinates[0] === 'number') {
    return project(coordinates)
  }
  return coordinates.map(projectCoordinates)
}

/**
 * Return `geometry` in EPSG:27700.
 *
 * A geometry already in British National Grid is returned untouched — the
 * common case, and the one where an unnecessary copy would be pure cost.
 * Anything that is neither 27700 nor 4326 throws: the GeoPackage reader only
 * admits those two SRIDs (`SUPPORTED_SRIDS` in read-feature-tables.js), so
 * reaching here with a third means the reader's guard has been bypassed.
 *
 * GeometryCollection is not handled: no BNG layer carries one, the format gate
 * rejects unexpected geometry types before validation, and silently returning
 * an unprojected collection would be worse than failing loudly.
 *
 * @param {object} geometry GeoJSON geometry
 * @param {number} srid the geometry's native SRID
 * @returns {object} geometry in EPSG:27700
 */
export function toBritishNationalGrid(geometry, srid) {
  if (srid === EPSG_BNG) {
    return geometry
  }
  if (srid !== EPSG_WGS84) {
    throw new Error(
      `Cannot reproject SRID ${srid} to ${EPSG_BNG}: only ${EPSG_WGS84} and ${EPSG_BNG} are supported`
    )
  }
  if (!Array.isArray(geometry?.coordinates)) {
    throw new TypeError(
      `Cannot reproject a ${geometry?.type ?? 'null'} geometry: no coordinates array`
    )
  }
  return {
    type: geometry.type,
    coordinates: projectCoordinates(geometry.coordinates)
  }
}
