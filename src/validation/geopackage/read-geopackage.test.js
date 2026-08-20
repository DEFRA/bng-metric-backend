import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GP10_APP_ID,
  LAYER_RLB,
  LAYER_HABITATS,
  ALL_LAYERS,
  EPSG_BNG,
  EPSG_WEB_MERCATOR,
  buildBuffer,
  fullReadBuffer,
  mutateSerializedBuffer,
  withTempGpkgFile,
  buildBufferWithRedLineBoundaryAliasTable,
  wrapGpkgWkb,
  makeInvalidEnvelopeBlob,
  readTestPolygonWkb,
  readTestMultiPolygonWkb
} from '../../../test/helpers/gpkg.js'

const { readGeoPackage } = await import('./geopackage.js')

// ---------------------------------------------------------------------------

describe('readGeoPackage feature decoding', () => {
  it('returns GeoJSON features per logical layer and only IGGI is missing from the template', async () => {
    await withTempGpkgFile(fullReadBuffer(), (filePath) => {
      const r = readGeoPackage(filePath)
      expect(r.missingLayers).toEqual(['iggis'])
      expect(r.redline).toHaveLength(1)
      expect(r.redline[0].type).toBe('Feature')
      expect(r.redline[0].nativeSrid).toBe(EPSG_BNG)
      expect(r.redline[0].nativeGeometry.type).toBe('Polygon')
      expect(r.areas).toHaveLength(1)
      expect(r.areas[0].nativeGeometry.type).toBe('MultiPolygon')
      expect(r.hedgerows).toHaveLength(1)
      expect(r.hedgerows[0].nativeGeometry.type).toBe('LineString')
      expect(r.watercourses).toHaveLength(1)
      expect(r.watercourses[0].nativeGeometry.type).toBe('LineString')
      expect(r.trees).toHaveLength(1)
      expect(r.trees[0].nativeGeometry.type).toBe('Point')
    })
  })

  it('caches each geometry as a geometryJson string at decode', async () => {
    // BMD-914: validation, sizing and persist all need the string form, so it
    // is serialised once here and carried alongside the geometry object.
    await withTempGpkgFile(fullReadBuffer(), (filePath) => {
      const r = readGeoPackage(filePath)
      const decoded = [
        ...r.redline,
        ...r.areas,
        ...r.hedgerows,
        ...r.watercourses,
        ...r.trees
      ]
      expect(decoded.length).toBeGreaterThan(0)
      for (const feature of decoded) {
        expect(feature.geometryJson).toBe(
          JSON.stringify(feature.nativeGeometry)
        )
      }
    })
  })

  it('copies non-geometry attribute columns into Feature properties', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.prepare(`UPDATE "Habitats" SET "Parcel Ref" = ? WHERE rowid = 1`).run(
        'PR-42'
      )
    })
    await withTempGpkgFile(buf, (filePath) => {
      const r = readGeoPackage(filePath)
      expect(r.areas[0].properties['Parcel Ref']).toBe('PR-42')
    })
  })

  it('skips rows whose geometry blob is too short to decode', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.prepare(`INSERT INTO "Habitats" (geom) VALUES (?)`).run(
        Buffer.alloc(4)
      )
    })
    await withTempGpkgFile(buf, (filePath) => {
      const r = readGeoPackage(filePath)
      expect(r.areas).toHaveLength(1)
    })
  })

  it('skips rows whose geometry blob is null', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.prepare(`UPDATE "Habitats" SET geom = NULL WHERE rowid = 1`).run()
    })
    await withTempGpkgFile(buf, (filePath) => {
      const r = readGeoPackage(filePath)
      expect(r.areas).toHaveLength(0)
    })
  })
})

describe('readGeoPackage error cases', () => {
  it('throws when a geometry blob has invalid GeoPackageBinary magic', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      const junk = Buffer.concat([
        Buffer.alloc(8, 0),
        readTestMultiPolygonWkb()
      ])
      db.prepare(`UPDATE "Habitats" SET geom = ? WHERE rowid = 1`).run(junk)
    })
    await withTempGpkgFile(buf, (filePath) => {
      expect(() => readGeoPackage(filePath)).toThrow(/bad magic/i)
    })
  })

  it('throws when the envelope indicator is out of range', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.prepare(`UPDATE "Habitats" SET geom = ? WHERE rowid = 1`).run(
        makeInvalidEnvelopeBlob()
      )
    })
    await withTempGpkgFile(buf, (filePath) => {
      expect(() => readGeoPackage(filePath)).toThrow(/envelope indicator/i)
    })
  })

  it('throws when the blob declares an unsupported SRS', async () => {
    const buf = buildBuffer({
      appId: GP10_APP_ID,
      systemTables: true,
      featureLayers: ALL_LAYERS,
      layerFeatures: {
        [LAYER_RLB]: [wrapGpkgWkb(readTestPolygonWkb(), EPSG_WEB_MERCATOR)],
        [LAYER_HABITATS]: [wrapGpkgWkb(readTestMultiPolygonWkb())]
      }
    })
    await withTempGpkgFile(buf, (filePath) => {
      expect(() => readGeoPackage(filePath)).toThrow(/Unsupported SRID/)
    })
  })

  it('throws when the blob srs_id is absent in the header and the layer table SRS is unsupported', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.prepare(
        `UPDATE gpkg_geometry_columns SET srs_id = ? WHERE table_name = ?`
      ).run(EPSG_WEB_MERCATOR, LAYER_RLB)
      db.prepare(`UPDATE "${LAYER_RLB}" SET geometry = ? WHERE rowid = 1`).run(
        wrapGpkgWkb(readTestPolygonWkb(), 0)
      )
    })
    await withTempGpkgFile(buf, (filePath) => {
      expect(() => readGeoPackage(filePath)).toThrow(/Unsupported SRID/)
    })
  })

  it('throws when the file does not exist', () => {
    expect(() =>
      readGeoPackage(join(tmpdir(), `missing-${Date.now()}.gpkg`))
    ).toThrow()
  })
})

describe('readGeoPackage layer resolution', () => {
  it('returns no features when gpkg_geometry_columns has no row for the table', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.prepare('DELETE FROM gpkg_geometry_columns WHERE table_name = ?').run(
        'Habitats'
      )
    })
    await withTempGpkgFile(buf, (filePath) => {
      const r = readGeoPackage(filePath)
      expect(r.areas).toEqual([])
    })
  })

  it('resolves the red_line_boundary table alias to the redline logical layer', async () => {
    await withTempGpkgFile(
      buildBufferWithRedLineBoundaryAliasTable(),
      (filePath) => {
        const r = readGeoPackage(filePath)
        expect(r.redline).toHaveLength(1)
        const byLocale = (a, b) => String(a).localeCompare(String(b))
        expect(r.missingLayers.toSorted(byLocale)).toEqual(
          ['areas', 'hedgerows', 'iggis', 'trees', 'watercourses'].toSorted(
            byLocale
          )
        )
      }
    )
  })

  it('resolves Trees via baseline_trees alias (not the canonical Urban Trees label)', async () => {
    const buf = mutateSerializedBuffer(fullReadBuffer(), (db) => {
      db.exec('ALTER TABLE "Urban Trees" RENAME TO baseline_trees')
      db.prepare(
        `UPDATE gpkg_contents SET table_name = ? WHERE table_name = ?`
      ).run('baseline_trees', 'Urban Trees')
      db.prepare(
        `UPDATE gpkg_geometry_columns SET table_name = ? WHERE table_name = ?`
      ).run('baseline_trees', 'Urban Trees')
    })
    await withTempGpkgFile(buf, (filePath) => {
      const r = readGeoPackage(filePath)
      expect(r.trees).toHaveLength(1)
      expect(r.trees[0].nativeGeometry.type).toBe('Point')
    })
  })

  it('decodes GeoPackageBinary when the SRS in the header is stored big-endian', async () => {
    const buf = fullReadBuffer({
      [LAYER_RLB]: [wrapGpkgWkb(readTestPolygonWkb(), EPSG_BNG, false)]
    })
    await withTempGpkgFile(buf, (filePath) => {
      const r = readGeoPackage(filePath)
      expect(r.redline).toHaveLength(1)
      expect(r.redline[0].nativeGeometry.type).toBe('Polygon')
    })
  })
})
