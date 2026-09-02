import { describe, expect, it } from 'vitest'

import { EPSG_27700_DEFINITION, toBritishNationalGrid } from './reproject.js'

describe('EPSG:27700 definition', () => {
  // The gotcha this guards against: several published EPSG:27700 definitions
  // omit +towgs84 entirely. Using one of those does not fail — it silently
  // places every WGS84 upload a few hundred metres from where PostGIS puts it.
  it('carries the seven Helmert parameters', () => {
    expect(EPSG_27700_DEFINITION).toContain(
      '+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489'
    )
  })

  it('is a transverse Mercator on the Airy ellipsoid with the OSGB origin', () => {
    expect(EPSG_27700_DEFINITION).toContain('+proj=tmerc')
    expect(EPSG_27700_DEFINITION).toContain('+ellps=airy')
    expect(EPSG_27700_DEFINITION).toContain('+lat_0=49')
    expect(EPSG_27700_DEFINITION).toContain('+lon_0=-2')
    expect(EPSG_27700_DEFINITION).toContain('+x_0=400000')
    expect(EPSG_27700_DEFINITION).toContain('+y_0=-100000')
  })
})

describe('toBritishNationalGrid', () => {
  // PostGIS's own answer for this point, to 3 dp. Agreement to a millimetre is
  // 100x inside the validator's tightest tolerance (0.1 m).
  it('matches PostGIS ST_Transform for a known point', () => {
    const { coordinates } = toBritishNationalGrid(
      { type: 'Point', coordinates: [-0.72, 51.52] },
      4326
    )
    expect(coordinates[0]).toBeCloseTo(488_906.998, 3)
    expect(coordinates[1]).toBeCloseTo(180_896.437, 3)
  })

  it('projects every position of a nested coordinate structure', () => {
    const projected = toBritishNationalGrid(
      {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-0.72, 51.52],
              [-0.71, 51.52],
              [-0.71, 51.53],
              [-0.72, 51.52]
            ]
          ]
        ]
      },
      4326
    )
    expect(projected.type).toBe('MultiPolygon')
    for (const position of projected.coordinates[0][0]) {
      expect(position[0]).toBeGreaterThan(400_000)
      expect(position[1]).toBeGreaterThan(100_000)
    }
  })

  it('returns a British National Grid geometry untouched, without copying', () => {
    const geometry = { type: 'Point', coordinates: [530_000, 180_000] }
    expect(toBritishNationalGrid(geometry, 27_700)).toBe(geometry)
  })

  it('refuses an SRID the GeoPackage reader would not have admitted', () => {
    expect(() =>
      toBritishNationalGrid({ type: 'Point', coordinates: [0, 0] }, 3857)
    ).toThrow(/only 4326 and 27700 are supported/)
  })

  it('refuses a geometry with no coordinates array', () => {
    expect(() =>
      toBritishNationalGrid(
        { type: 'GeometryCollection', geometries: [] },
        4326
      )
    ).toThrow(/no coordinates array/)
  })
})
