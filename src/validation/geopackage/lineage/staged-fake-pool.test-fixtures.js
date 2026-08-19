// A pg-pool stand-in for staged-validation unit tests: recognises each of the
// staged validator's SQL shapes by a distinctive fragment and answers with
// planar maths computed in JS from the GeoJSON the caller sent, so the fake
// can never disagree with the geometry in the file under test.
//
// Overlap queries (lineage inference, containment) answer "nothing overlaps /
// nothing escapes" — the unit fixtures draw new features away from the
// baseline and stamped children exactly on their parents, so that is the
// truthful answer without reimplementing PostGIS.

export function planarLength(geometry) {
  const coords = geometry?.coordinates ?? []
  let total = 0
  for (let i = 1; i < coords.length; i += 1) {
    total += Math.hypot(
      coords[i][0] - coords[i - 1][0],
      coords[i][1] - coords[i - 1][1]
    )
  }
  return total
}

export function shoelaceArea(geometry) {
  const ring = geometry?.coordinates?.[0] ?? []
  let doubled = 0
  for (let i = 1; i < ring.length; i += 1) {
    doubled += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
  }
  return Math.abs(doubled / 2)
}

function sizeOf(geometryJson, measure) {
  const geometry = JSON.parse(geometryJson)
  return measure === 'area' ? shoelaceArea(geometry) : planarLength(geometry)
}

/**
 * @returns {{ query: Function, calls: string[] }} a pg-pool stand-in that
 *   logs each SQL text it was asked to run
 */
export function fakeStagedPool() {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push(sql)
      if (sql.includes('WITH ORDINALITY')) {
        // FEATURE_SIZES_SQL — per-feature sizes, aligned with the input order
        const [geoms, measure] = params
        return {
          rows: geoms.map((geom, idx) => ({
            idx,
            size: sizeOf(geom, measure)
          }))
        }
      }
      if (sql.includes('baseline_total')) {
        // SIZE_SQL — stage totals for the EXACT rule
        const [stages, geoms, , measure] = params
        let baselineTotal = 0
        let piTotal = 0
        stages.forEach((stage, index) => {
          const size = sizeOf(geoms[index], measure)
          if (stage === 'baseline') {
            baselineTotal += size
          } else {
            piTotal += size
          }
        })
        return { rows: [{ baseline_total: baselineTotal, pi_total: piTotal }] }
      }
      if (sql.includes('shared_size')) {
        // lineage geometry inference — nothing overlaps
        return { rows: [] }
      }
      if (sql.includes('escape_size')) {
        // containment — nothing escapes
        return { rows: [] }
      }
      throw new Error(`fakeStagedPool: unrecognised SQL: ${sql.slice(0, 80)}`)
    }
  }
}
