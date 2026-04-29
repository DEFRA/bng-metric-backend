import crypto from 'node:crypto'

const TARGET_SRID = 27700

const LAYERS_TO_LOAD = [
  'redline',
  'areas',
  'hedgerows',
  'watercourses',
  'iggis',
  'trees'
]

/**
 * Stage every feature in `layers` into bng.baseline_validation_geom under a
 * fresh run_id. Geometries are reprojected to EPSG:27700 in SQL so callers can
 * stay agnostic about input SRID.
 *
 * Returns { runId, cleanup }. The caller must invoke cleanup() once validation
 * is complete to drop the rows for this run.
 *
 * @param {import('pg-pool').default | import('pg').Pool} pool
 * @param {object} layers Output of readBaselineGeoPackage
 */
export async function loadValidationRun(pool, layers) {
  const runId = crypto.randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const layer of LAYERS_TO_LOAD) {
      const features = layers[layer] ?? []
      if (features.length === 0) {
        continue
      }
      await insertLayer(client, runId, layer, features)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  return {
    runId,
    cleanup: () => cleanupRun(pool, runId)
  }
}

async function insertLayer(client, runId, layer, features) {
  const idxs = []
  const propsArr = []
  const geoms = []
  const srids = []
  features.forEach((feature, index) => {
    const geom = feature.nativeGeometry ?? feature.geometry
    const srid = feature.nativeSrid ?? 4326
    if (!geom) {
      return
    }
    idxs.push(index)
    propsArr.push(JSON.stringify(feature.properties ?? {}))
    geoms.push(JSON.stringify(geom))
    srids.push(srid)
  })

  if (idxs.length === 0) {
    return
  }

  await client.query(
    `INSERT INTO bng.baseline_validation_geom (run_id, layer, feature_idx, props, geom)
     SELECT $1::uuid, $2::text, idx, props::jsonb,
            ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), $3::int)
     FROM unnest($4::int[], $5::text[], $6::text[], $7::int[])
       AS t(idx, props, g, srid)`,
    [runId, layer, TARGET_SRID, idxs, propsArr, geoms, srids]
  )
}

async function cleanupRun(pool, runId) {
  await pool.query(
    'DELETE FROM bng.baseline_validation_geom WHERE run_id = $1',
    [runId]
  )
}
