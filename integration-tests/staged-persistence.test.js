// The staged persistence seam, end to end: one staged GeoPackage uploaded
// through the EXISTING baseline plumbing (initiate → CDP uploader → POST
// /baseline/validate/{uploadId} with a projectId) must persist BOTH subtrees —
// exactly the shapes the two legacy uploads would have produced — run BOTH
// unit enrichments (including vertical area habitats), and persist the
// per-parent removal report as `removedHabitats` on the post-intervention
// subtree. The FE then reads it all from the same endpoints it already uses.
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { ERROR_CODES } from '../src/validation/geopackage/errors.js'
import { HTTP_OK } from './helpers/http-status.js'
import {
  BNG_SRID,
  callValidate,
  countLayer,
  createProject,
  fetchLayerRows,
  fetchProject,
  fetchProjectAudit,
  getPersistenceTestContext,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

const STAGED_FIXTURE = 'staged-baseline-and-pi.gpkg'
const HTTP_NOT_FOUND = 404

// Hand-computed vertical area habitat expectations — the same arithmetic as
// the unit tests (see enrich-baseline-units.vertical-areas.test.js):
// baseline 150 m² × Low(2) × Moderate(2) = 0.06;
// enhanced 250 m²: (0.15 − 0.10) × 0.931225 × 0.67 + 0.10 = 0.1311960375.
const VAH_BASELINE_UNITS = 0.06
const VAH_ENHANCED_UNITS = 0.1311960375

// The fixture's two deliberate removals, recorded by absence.
const HEDGE_TOTAL_M = 200
const HEDGE_REMOVED_M = 100
const TREE_REMOVED_COUNT = 1

const GEOMETRY_TABLE_EXPECTATIONS = [
  ['baseline_red_line', 1, 'MULTIPOLYGON'],
  ['baseline_habitats', 2, 'MULTIPOLYGON'],
  ['baseline_hedgerows', 1, 'MULTILINESTRING'],
  ['baseline_watercourses', 1, 'MULTILINESTRING'],
  ['baseline_trees', 2, 'MULTIPOINT'],
  ['post_intervention_red_line', 1, 'MULTIPOLYGON'],
  ['post_intervention_habitats', 3, 'MULTIPOLYGON'],
  ['post_intervention_hedgerows', 1, 'MULTILINESTRING'],
  ['post_intervention_watercourses', 1, 'MULTILINESTRING'],
  ['post_intervention_trees', 2, 'MULTIPOINT']
]

async function uploadAndPersist(projectId) {
  const uploadId = await uploadFixture(STAGED_FIXTURE)
  const res = await callValidate(uploadId, { projectId })
  return { uploadId, res }
}

function featureIdsByRef(featureSet) {
  const ids = {}
  for (const layer of [
    'habitats',
    'verticalAreas',
    'hedgerows',
    'watercourses',
    'trees'
  ]) {
    for (const feature of featureSet?.[layer] ?? []) {
      ids[`${layer}:${feature.ref}`] = feature.featureId
    }
  }
  return ids
}

describe('POST /baseline/validate/{uploadId} - staged persistence', () => {
  it('persists both subtrees, both enrichments, and the removal report from one staged file', async () => {
    const { server, headers, userId } = getPersistenceTestContext()
    const project = await createProject('Integration test - staged')
    const { uploadId, res } = await uploadAndPersist(project.id)

    // 1. Response shape unchanged: { valid, errors, warnings }, with the
    //    removal warning surviving the persistence detour.
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.valid).toBe(true)
    expect(res.result.errors).toEqual([])
    expect(res.result.warnings.map((w) => w.code)).toContain(
      ERROR_CODES.STAGED_FEATURES_REMOVED
    )

    const stored = await fetchProject(project.id)

    // 2. Both subtrees, from the one file.
    expect(stored.baseline).toBeDefined()
    expect(stored.postIntervention).toBeDefined()
    expect(stored.baseline.uploadId).toBe(uploadId)
    expect(stored.postIntervention.uploadId).toBe(uploadId)

    // 3. Baseline subtree: legacy shape + vertical areas, fully enriched.
    expect(stored.baseline.redLine).toBeDefined()
    expect(stored.baseline.habitats).toHaveLength(2)
    expect(stored.baseline.verticalAreas).toHaveLength(1)
    expect(stored.baseline.hedgerows).toHaveLength(1)
    expect(stored.baseline.watercourses).toHaveLength(1)
    expect(stored.baseline.trees).toHaveLength(2)
    for (const feature of [
      ...stored.baseline.habitats,
      ...stored.baseline.verticalAreas,
      ...stored.baseline.hedgerows,
      ...stored.baseline.watercourses,
      ...stored.baseline.trees
    ]) {
      expect(feature.status).toBe('Complete')
      expect(typeof feature.units).toBe('number')
      expect(feature.units).toBeGreaterThan(0)
    }
    const baselineVah = stored.baseline.verticalAreas[0]
    expect(baselineVah.ref).toBe('VAH-1')
    expect(baselineVah.units).toBe(VAH_BASELINE_UNITS)
    expect(baselineVah.sizeSquareMetres).toBe(150)
    expect(stored.baseline.units.verticalAreasTotal).toBe(VAH_BASELINE_UNITS)
    expect(stored.baseline.units.totalUnits).toBeGreaterThan(0)
    expect(stored.baseline.habitatSizes).toBeDefined()

    // 4. Post-intervention subtree: legacy shape + vertical areas + removals.
    expect(stored.postIntervention.habitats).toHaveLength(3)
    expect(stored.postIntervention.verticalAreas).toHaveLength(1)
    expect(stored.postIntervention.hedgerows).toHaveLength(1)
    expect(stored.postIntervention.watercourses).toHaveLength(1)
    expect(stored.postIntervention.trees).toHaveLength(2)
    const piVah = stored.postIntervention.verticalAreas[0]
    expect(piVah.ref).toBe('VAH-1')
    expect(piVah.retentionCategory).toBe('Enhanced')
    expect(piVah.units).toBe(VAH_ENHANCED_UNITS)
    expect(stored.postIntervention.units.verticalAreasTotal).toBe(
      VAH_ENHANCED_UNITS
    )
    // Net-change fields prove the PI enrichment saw the fresh baseline.
    expect(stored.postIntervention.units.habitatsNetUnitChange).toEqual(
      expect.any(Number)
    )

    // 5. The removal report, exactly as the seam contract spells it.
    expect(stored.postIntervention.removedHabitats).toHaveLength(2)
    const [hedge, tree] = stored.postIntervention.removedHabitats
    expect(hedge).toMatchObject({
      type: 'hedgerows',
      parentRef: 'HR-1',
      measure: 'length'
    })
    expect(hedge.baselineSize).toBeCloseTo(HEDGE_TOTAL_M, 1)
    expect(hedge.removedSize).toBeCloseTo(HEDGE_REMOVED_M, 1)
    expect(tree).toEqual({
      type: 'trees',
      parentRef: 'T-2',
      measure: 'count',
      baselineSize: TREE_REMOVED_COUNT,
      removedSize: TREE_REMOVED_COUNT
    })

    // 6. Geometry rows for both stages, transformed to BNG multi-geometries.
    //    (Vertical areas have no PostGIS table; they live in JSONB only.)
    for (const [table, count, geomType] of GEOMETRY_TABLE_EXPECTATIONS) {
      const rows = await fetchLayerRows(table, project.id)
      expect(rows, table).toHaveLength(count)
      for (const row of rows) {
        expect(row.srid).toBe(BNG_SRID)
        expect(row.is_valid).toBe(true)
        expect(row.geom_type).toBe(geomType)
      }
    }
    const piHabitatRows = await fetchLayerRows(
      'post_intervention_habitats',
      project.id
    )
    const piHabitatIds = stored.postIntervention.habitats.map(
      (h) => h.featureId
    )
    for (const row of piHabitatRows) {
      expect(piHabitatIds).toContain(row.id)
    }

    // 7. The FE reads it from the endpoints it already uses.
    const projectRes = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers
    })
    expect(projectRes.statusCode).toBe(HTTP_OK)
    expect(projectRes.result.project.baseline.verticalAreas).toHaveLength(1)
    expect(
      projectRes.result.project.postIntervention.removedHabitats
    ).toHaveLength(2)

    const piHabitat = stored.postIntervention.habitats.find(
      (h) => h.ref === 'PI-POND'
    )
    const featureRes = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}/post-intervention/features/${piHabitat.featureId}`,
      headers
    })
    expect(featureRes.statusCode).toBe(HTTP_OK)
    expect(featureRes.result).toEqual({ type: 'habitat', feature: piHabitat })

    // 8. The write is audited as this user's update. The two document writes
    //    share one transaction (same audited_at, random uuid ids), so the
    //    rows are matched on content rather than position.
    const auditRows = await fetchProjectAudit(project.id)
    const uploadAudit = auditRows.find(
      (row) => row.project?.postIntervention?.uploadId === uploadId
    )
    expect(uploadAudit).toMatchObject({ operation: 'UPDATE', user_id: userId })
    expect(uploadAudit.project.baseline.uploadId).toBe(uploadId)
  })

  it('keeps every featureId stable across a staged re-upload', async () => {
    const project = await createProject('Integration test - staged re-upload')

    const first = await uploadAndPersist(project.id)
    expect(first.res.statusCode).toBe(HTTP_OK)
    const firstStored = await fetchProject(project.id)

    const second = await uploadAndPersist(project.id)
    expect(second.res.statusCode).toBe(HTTP_OK)
    const secondStored = await fetchProject(project.id)

    // The uuid-keyed carry-forward ran against the REAL persisted document:
    // nothing was re-keyed, on either side of either stage.
    expect(featureIdsByRef(secondStored.baseline)).toEqual(
      featureIdsByRef(firstStored.baseline)
    )
    expect(featureIdsByRef(secondStored.postIntervention)).toEqual(
      featureIdsByRef(firstStored.postIntervention)
    )
    expect(secondStored.baseline.redLine.featureId).toBe(
      firstStored.baseline.redLine.featureId
    )
  })

  it('persists nothing for a projectId that is not visible to the user', async () => {
    const missingProjectId = randomUUID()
    const { res } = await uploadAndPersist(missingProjectId)

    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
    expect(await countLayer('baseline_habitats', missingProjectId)).toBe(0)
    expect(
      await countLayer('post_intervention_habitats', missingProjectId)
    ).toBe(0)
  })

  it('still validates without persisting when no projectId is supplied', async () => {
    const uploadId = await uploadFixture(STAGED_FIXTURE)

    const res = await callValidate(uploadId)

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.valid).toBe(true)
  })
})
