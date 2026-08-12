import wkx from 'wkx'

import {
  EPSG_BNG,
  GPKG_MAGIC_BYTE_G,
  GPKG_MAGIC_BYTE_P,
  GPKG_FLAGS_BYTE_INDEX,
  WKB_MIN_BYTES,
  WKB_POLYGON,
  WKB_LINE_STRING,
  WKB_POINT
} from '../../src/validation/geopackage/geopackage-constants.js'

import {
  TEST_SW_EASTING,
  TEST_SW_NORTHING,
  TEST_NE_EASTING,
  TEST_NE_NORTHING,
  TEST_MID_EASTING,
  TEST_MID_NORTHING,
  TEST_QUARTER_EASTING,
  TEST_QUARTER_NORTHING
} from './gpkg-db-fixtures.js'

export function makeGpkgBlob(wkbType) {
  return makeGpkgBlobWithSrid(wkbType, 0, true)
}

export function makeGpkgBlobWithSrid(
  wkbType,
  srsId,
  littleEndianWkbAndSrs = true
) {
  const flags = littleEndianWkbAndSrs ? 0x01 : 0x00
  const header = Buffer.alloc(8)
  header[0] = GPKG_MAGIC_BYTE_G
  header[1] = GPKG_MAGIC_BYTE_P
  header[2] = 0x00
  header[GPKG_FLAGS_BYTE_INDEX] = flags
  if (littleEndianWkbAndSrs) {
    header.writeInt32LE(srsId, 4)
  } else {
    header.writeInt32BE(srsId, 4)
  }
  const wkb = Buffer.allocUnsafe(WKB_MIN_BYTES)
  if (littleEndianWkbAndSrs) {
    wkb.writeUInt8(1, 0)
    wkb.writeUInt32LE(wkbType, 1)
  } else {
    wkb.writeUInt8(0, 0)
    wkb.writeUInt32BE(wkbType, 1)
  }
  return Buffer.concat([header, wkb])
}

export function wrapGpkgWkb(
  wkbBuffer,
  srsId = EPSG_BNG,
  headerSrsLittleEndian = true
) {
  const flags = headerSrsLittleEndian ? 0x01 : 0x00
  const header = Buffer.alloc(8)
  header[0] = GPKG_MAGIC_BYTE_G
  header[1] = GPKG_MAGIC_BYTE_P
  header[2] = 0x00
  header[GPKG_FLAGS_BYTE_INDEX] = flags
  if (headerSrsLittleEndian) {
    header.writeInt32LE(srsId, 4)
  } else {
    header.writeInt32BE(srsId, 4)
  }
  return Buffer.concat([header, Buffer.from(wkbBuffer)])
}

const TEST_SQ_RING = [
  new wkx.Point(TEST_SW_EASTING, TEST_SW_NORTHING),
  new wkx.Point(TEST_NE_EASTING, TEST_SW_NORTHING),
  new wkx.Point(TEST_NE_EASTING, TEST_NE_NORTHING),
  new wkx.Point(TEST_SW_EASTING, TEST_NE_NORTHING),
  new wkx.Point(TEST_SW_EASTING, TEST_SW_NORTHING)
]

export function readTestPolygonWkb() {
  return new wkx.Polygon(TEST_SQ_RING).toWkb()
}

export function readTestMultiPolygonWkb() {
  return new wkx.MultiPolygon([new wkx.Polygon(TEST_SQ_RING)]).toWkb()
}

export function readTestLineStringWkb() {
  return new wkx.LineString([
    new wkx.Point(TEST_SW_EASTING, TEST_SW_NORTHING),
    new wkx.Point(TEST_MID_EASTING, TEST_MID_NORTHING)
  ]).toWkb()
}

export function readTestPointWkb() {
  return new wkx.Point(TEST_QUARTER_EASTING, TEST_QUARTER_NORTHING).toWkb()
}

export const makePolygon = () => makeGpkgBlob(WKB_POLYGON)
export const makeLineString = () => makeGpkgBlob(WKB_LINE_STRING)
export const makePoint = () => makeGpkgBlob(WKB_POINT)

export const makeCorruptBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P])

export const makeInvalidEnvelopeBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00]) // prettier-ignore

export const makeTruncatedEnvelopeBlob = () =>
  Buffer.from([GPKG_MAGIC_BYTE_G, GPKG_MAGIC_BYTE_P, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]) // prettier-ignore
