// Derive baseline → post-intervention lineage for a staged GeoPackage.
//
// Sources of truth, in this order:
//
//  1. The STAMPED parent — `parent_uuid` first (a hidden machine key humans
//     never see or type, so renames cannot break it), falling back to the
//     human-readable `Parent Ref` for files made before the uuid columns
//     existed. The QGIS template writes both once when the post-intervention
//     layer is copied from the baseline, and QGIS carries attributes verbatim
//     through a split, so every parcel derived by splitting keeps the correct
//     parent with no geometry involved. Trust it.
//
//  2. Geometry, only for rows with no stamped parent — parcels a surveyor drew
//     fresh, which need no parent for their units. (They are Created, but the
//     converse does not hold: built-over ground is also recorded as Created —
//     the Statutory Metric treats development as creating the new surface —
//     and keeps its stamped parent. The stamp, not the category, decides.)
//     Here the apportionment matters for area reconciliation, not the metric.
//
// The geometry rule is AREA-WEIGHTED INTERSECTION, never a bare ST_Intersects.
// Post-intervention parcels are cut from the baseline, so they share edges with
// their parents' neighbours, and `intersects` is true for anything merely
// touching. Testing against the QGIS prototype showed every post-intervention
// parcel "intersecting" both baseline parcels while genuinely overlapping only
// one. A bare intersects test would attribute parentage wrongly on essentially
// every parcel, and plausibly enough to go unnoticed.

import { OVERLAY_GRID_SIZE_M } from '../postgis/constants.js'

/** Slivers below this contribute nothing and are discarded. */
export const MIN_SHARED_AREA_SQ_M = 1

/** Same, for linear features, in metres of shared length. */
export const MIN_SHARED_LENGTH_M = 0.5

/**
 * Apportion each post-intervention polygon across the baseline polygons it
 * genuinely overlaps. One row per (pi, baseline) pair with a real shared area.
 */
const AREA_LINEAGE_SQL = /* sql */ `
WITH pi AS (
  SELECT idx, ref, ST_MakeValid(ST_GeomFromGeoJSON(geom)) AS geom
  FROM unnest($1::int[], $2::text[], $3::text[]) AS t(idx, ref, geom)
),
base AS (
  SELECT ref, ST_MakeValid(ST_GeomFromGeoJSON(geom)) AS geom
  FROM unnest($4::text[], $5::text[]) AS t(ref, geom)
)
SELECT pi.idx           AS pi_index,
       pi.ref           AS pi_ref,
       base.ref         AS baseline_ref,
       ST_Area(ST_Intersection(pi.geom, base.geom, ${OVERLAY_GRID_SIZE_M})) AS shared_size
FROM pi
JOIN base
  ON ST_Intersects(pi.geom, base.geom)
WHERE ST_Area(ST_Intersection(pi.geom, base.geom, ${OVERLAY_GRID_SIZE_M})) >= $6
ORDER BY pi.idx, shared_size DESC
`

/** The linear equivalent: shared length rather than shared area. */
const LINEAR_LINEAGE_SQL = /* sql */ `
WITH pi AS (
  SELECT idx, ref, ST_GeomFromGeoJSON(geom) AS geom
  FROM unnest($1::int[], $2::text[], $3::text[]) AS t(idx, ref, geom)
),
base AS (
  SELECT ref, ST_GeomFromGeoJSON(geom) AS geom
  FROM unnest($4::text[], $5::text[]) AS t(ref, geom)
)
SELECT pi.idx   AS pi_index,
       pi.ref   AS pi_ref,
       base.ref AS baseline_ref,
       ST_Length(ST_Intersection(pi.geom, base.geom)) AS shared_size
FROM pi
JOIN base
  ON ST_Intersects(pi.geom, base.geom)
WHERE ST_Length(ST_Intersection(pi.geom, base.geom)) >= $6
ORDER BY pi.idx, shared_size DESC
`

function toArrays(features, refKey) {
  const indexes = []
  const refs = []
  const geoms = []
  features.forEach((feature, idx) => {
    indexes.push(idx)
    refs.push(feature?.[refKey] ?? null)
    geoms.push(JSON.stringify(feature?.geometry ?? null))
  })
  return { indexes, refs, geoms }
}

/**
 * @param {import('pg').Pool} pool
 * @param {object[]} postIntervention features with { piRef, parentRef, geometry }
 * @param {object[]} baseline features with { ref, geometry }
 * @param {{ linear?: boolean }} [options]
 * @returns {Promise<Array<{ piIndex: number, piRef: string|null, parents: Array<{ ref: string, sharedSize: number, share: number }>, source: 'stamped'|'geometry'|'none' }>>}
 */
export async function deriveLineage(
  pool,
  postIntervention = [],
  baseline = [],
  { linear = false } = {}
) {
  const results = postIntervention.map((feature, piIndex) => ({
    piIndex,
    piRef: feature?.piRef ?? null,
    parents: [],
    source: 'none'
  }))

  // 1. stamped parents win outright: uuid first, ref as the fallback
  const baselineRefs = new Set(
    baseline.map((feature) => feature?.ref).filter((ref) => ref != null)
  )
  const refByUuid = new Map()
  for (const feature of baseline) {
    if (feature?.featureUuid && !refByUuid.has(feature.featureUuid)) {
      refByUuid.set(feature.featureUuid, feature?.ref ?? null)
    }
  }
  const needsGeometry = []
  postIntervention.forEach((feature, piIndex) => {
    const parentUuid = feature?.parentUuid
    const parentRef = feature?.parentRef
    if (parentUuid != null && parentUuid !== '' && refByUuid.has(parentUuid)) {
      results[piIndex].parents = [
        {
          ref: refByUuid.get(parentUuid) ?? parentRef ?? null,
          sharedSize: null,
          share: 1
        }
      ]
      results[piIndex].source = 'stamped'
      results[piIndex].stampedBy = 'uuid'
    } else if (
      parentRef != null &&
      parentRef !== '' &&
      baselineRefs.has(parentRef)
    ) {
      results[piIndex].parents = [
        { ref: parentRef, sharedSize: null, share: 1 }
      ]
      results[piIndex].source = 'stamped'
      results[piIndex].stampedBy = 'ref'
    } else {
      needsGeometry.push({ feature, piIndex })
    }
  })

  if (needsGeometry.length === 0 || baseline.length === 0) {
    return results
  }

  // 2. geometry, for the rest
  const pi = toArrays(
    needsGeometry.map((entry) => entry.feature),
    'geometry'
  )
  // preserve the caller's indexes through the query
  pi.indexes = needsGeometry.map((entry) => entry.piIndex)
  pi.refs = needsGeometry.map((entry) => entry.feature?.piRef ?? null)
  pi.geoms = needsGeometry.map((entry) =>
    JSON.stringify(entry.feature?.geometry ?? null)
  )
  const base = toArrays(baseline, 'ref')

  const { rows } = await pool.query(
    linear ? LINEAR_LINEAGE_SQL : AREA_LINEAGE_SQL,
    [
      pi.indexes,
      pi.refs,
      pi.geoms,
      base.refs,
      base.geoms,
      linear ? MIN_SHARED_LENGTH_M : MIN_SHARED_AREA_SQ_M
    ]
  )

  const byIndex = new Map()
  for (const row of rows) {
    const list = byIndex.get(row.pi_index) ?? []
    list.push({ ref: row.baseline_ref, sharedSize: Number(row.shared_size) })
    byIndex.set(row.pi_index, list)
  }
  for (const [piIndex, parents] of byIndex) {
    const total = parents.reduce((sum, p) => sum + p.sharedSize, 0)
    results[piIndex].parents = parents.map((p) => ({
      ...p,
      share: total > 0 ? p.sharedSize / total : 0
    }))
    results[piIndex].source = 'geometry'
  }
  return results
}
