const HABITAT_SIZE_LAYERS = ['areas', 'hedgerows', 'watercourses']

const CALCULATE_HABITAT_SIZES_QUERY = /* sql */ `
WITH features_in AS (
  SELECT layer,
         idx,
         props::jsonb AS props,
         ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), 27700) AS geom
  FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::int[])
    AS t(layer, idx, props, g, srid)
)
SELECT layer,
       idx,
       props->>'fid' AS fid,
       COALESCE(props->>'Parcel Ref', props->>'Baseline Parcel Ref') AS feature_ref,
       CASE
         WHEN layer = 'areas' THEN ST_Area(ST_MakeValid(geom))
         ELSE ST_Length(ST_MakeValid(geom))
       END AS size_value
FROM features_in
ORDER BY layer, idx
`

function buildLayerArrays(layers) {
  const layerNames = []
  const idxs = []
  const props = []
  const geoms = []
  const srids = []

  for (const layerName of HABITAT_SIZE_LAYERS) {
    const features = layers[layerName] ?? []

    features.forEach((feature, index) => {
      if (!feature?.nativeGeometry) {
        return
      }

      layerNames.push(layerName)
      idxs.push(index)
      props.push(JSON.stringify(feature.properties ?? {}))
      geoms.push(JSON.stringify(feature.nativeGeometry))
      srids.push(feature.nativeSrid)
    })
  }

  return { layerNames, idxs, props, geoms, srids }
}

function emptyResult() {
  return {
    areaHabitats: {
      individualSquareMetres: [],
      totalSquareMetres: 0
    },
    hedgerows: {
      individualMetres: [],
      totalMetres: 0
    },
    watercourses: {
      individualMetres: [],
      totalMetres: 0
    }
  }
}

function mapLayerToKey(layerName) {
  if (layerName === 'areas') {
    return 'areaHabitats'
  }
  if (layerName === 'hedgerows') {
    return 'hedgerows'
  }
  if (layerName === 'watercourses') {
    return 'watercourses'
  }

  return null
}

function appendCalculatedSizes(result, rows) {
  for (const row of rows) {
    const key = mapLayerToKey(row.layer)
    if (!key) {
      continue
    }

    const sizeValue = Number(row.size_value)
    if (key === 'areaHabitats') {
      result[key].individualSquareMetres.push({
        idx: row.idx,
        fid: row.fid ?? null,
        featureRef: row.feature_ref ?? null,
        sizeSquareMetres: sizeValue
      })
      result[key].totalSquareMetres += sizeValue
    } else {
      result[key].individualMetres.push({
        idx: row.idx,
        fid: row.fid ?? null,
        featureRef: row.feature_ref ?? null,
        sizeMetres: sizeValue
      })
      result[key].totalMetres += sizeValue
    }
  }
}

async function calculateHabitatSizes(pool, layers) {
  if (!pool) {
    throw new Error('calculateHabitatSizes requires a pg pool')
  }

  const { layerNames, idxs, props, geoms, srids } = buildLayerArrays(layers)

  if (layerNames.length === 0) {
    return emptyResult()
  }

  const { rows } = await pool.query(CALCULATE_HABITAT_SIZES_QUERY, [
    layerNames,
    idxs,
    props,
    geoms,
    srids
  ])

  const result = emptyResult()
  appendCalculatedSizes(result, rows)
  return result
}

export {
  HABITAT_SIZE_LAYERS,
  CALCULATE_HABITAT_SIZES_QUERY,
  buildLayerArrays,
  calculateHabitatSizes
}
