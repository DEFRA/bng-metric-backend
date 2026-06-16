import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import {
  fixturePath,
  uploadViaCdpUploader,
  waitForUploadStatus,
  assertCdpUploaderReachable,
  assertLocalStackPipelineReady
} from './helpers/upload-fixtures.js'
import { mintToken, authHeaders } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const HTTP_NOT_FOUND = 404
const BNG_SRID = 27700
const BUCKET = 'baseline-files'
const FIXTURE = 'baseline-complete.gpkg'
const NULL_AREA_CONDITION_FIXTURE = 'baseline-null-area-condition.gpkg'
const UNKNOWN_PROJECT_ID = '00000000-0000-4000-8000-000000000000'

let server
let dbClient
let headers
const userId = `it-${randomUUID()}`

beforeAll(async () => {
  await assertCdpUploaderReachable()
  await assertLocalStackPipelineReady()
  server = await startServer()
  dbClient = await connect()
  // Created projects have a null relationship → visible to their owner (sub).
  headers = authHeaders(await mintToken({ sub: userId }))
  await truncateTestData(dbClient)
})

afterEach(async () => {
  await truncateTestData(dbClient)
})

afterAll(async () => {
  await dbClient.end()
  await stopServer(server)
})

async function createProject(name) {
  const res = await server.inject({
    method: 'POST',
    url: '/projects/new',
    headers,
    payload: { project: { name } }
  })
  expect(res.statusCode).toBe(HTTP_OK)
  return res.result
}

async function uploadFixture(fixtureName) {
  const initiated = await server.inject({
    method: 'POST',
    url: '/upload/initiate',
    headers,
    payload: { redirect: '/done', s3Bucket: BUCKET, s3Path: 'baseline/' }
  })
  expect(initiated.statusCode).toBe(HTTP_OK)
  const { uploadId, uploadUrl } = initiated.result
  await uploadViaCdpUploader({
    uploadUrl,
    filePath: fixturePath(fixtureName)
  })
  await waitForUploadStatus(server, uploadId, {
    target: 'ready',
    timeoutMs: 20_000,
    headers
  })
  return uploadId
}

async function callValidate(uploadId, payload) {
  return server.inject({
    method: 'POST',
    url: `/baseline/validate/${uploadId}`,
    headers,
    payload
  })
}

async function callPostInterventionValidate(uploadId, payload) {
  return server.inject({
    method: 'POST',
    url: `/post-intervention/validate/${uploadId}`,
    headers,
    payload
  })
}

async function fetchProject(id) {
  const { rows } = await dbClient.query(
    'SELECT project FROM bng.projects WHERE id = $1',
    [id]
  )
  return rows[0]?.project
}

async function countLayer(table, projectId) {
  const { rows } = await dbClient.query(
    `SELECT COUNT(*)::int AS c FROM bng.${table} WHERE project_id = $1`,
    [projectId]
  )
  return rows[0].c
}

// `ref` is intentionally omitted from the SELECT — bng.baseline_red_line has no
// ref column (only one red line per project, so a per-feature ref would be
// meaningless), and none of the assertions consume it anyway.
async function fetchLayerRows(table, projectId) {
  const { rows } = await dbClient.query(
    `SELECT id, ST_SRID(geom) AS srid, ST_IsValid(geom) AS is_valid,
            GeometryType(geom) AS geom_type
       FROM bng.${table}
      WHERE project_id = $1
      ORDER BY id`,
    [projectId]
  )
  return rows
}

describe('POST /baseline/validate/{uploadId} — persistence (document + red line)', () => {
  it('persists the unpacked baseline against the project', async () => {
    const project = await createProject('Integration test — happy path')
    const uploadId = await uploadFixture(FIXTURE)

    const res = await callValidate(uploadId, { projectId: project.id })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ valid: true, errors: [] })

    // JSONB document carries the baseline block
    const stored = await fetchProject(project.id)
    expect(stored.baseline).toBeDefined()
    expect(stored.baseline.uploadId).toBe(uploadId)
    expect(stored.baseline.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(stored.baseline.redLine).not.toBeNull()
    expect(stored.baseline.redLine.featureId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(Array.isArray(stored.baseline.habitats)).toBe(true)
    expect(stored.baseline.habitats.length).toBeGreaterThan(0)
    const metricReadyHabitats = stored.baseline.habitats.filter(
      (h) => typeof h.units === 'number'
    )
    expect(metricReadyHabitats.length).toBeGreaterThan(0)

    expect(Array.isArray(stored.baseline.hedgerows)).toBe(true)
    expect(stored.baseline.hedgerows.length).toBeGreaterThan(0)
    const metricReadyHedgerows = stored.baseline.hedgerows.filter(
      (h) => typeof h.units === 'number'
    )
    expect(metricReadyHedgerows.length).toBeGreaterThan(0)

    expect(Array.isArray(stored.baseline.watercourses)).toBe(true)
    expect(stored.baseline.watercourses.length).toBeGreaterThan(0)
    const metricReadyWatercourses = stored.baseline.watercourses.filter(
      (w) => typeof w.units === 'number'
    )
    expect(metricReadyWatercourses.length).toBeGreaterThan(0)

    expect(stored.baseline.units).toEqual(
      expect.objectContaining({
        habitatsTotal: expect.any(Number),
        hedgerowsTotal: expect.any(Number),
        watercoursesTotal: expect.any(Number),
        totalUnits: expect.any(Number)
      })
    )
    const habitatsSum = metricReadyHabitats.reduce((sum, h) => sum + h.units, 0)
    const hedgerowsSum = metricReadyHedgerows.reduce(
      (sum, h) => sum + h.units,
      0
    )
    const watercoursesSum = metricReadyWatercourses.reduce(
      (sum, w) => sum + w.units,
      0
    )
    expect(stored.baseline.units.habitatsTotal).toBe(habitatsSum)
    expect(stored.baseline.units.hedgerowsTotal).toBe(hedgerowsSum)
    expect(stored.baseline.units.watercoursesTotal).toBe(watercoursesSum)
    expect(stored.baseline.units.totalUnits).toBe(
      stored.baseline.units.habitatsTotal +
        stored.baseline.units.hedgerowsTotal +
        stored.baseline.units.watercoursesTotal
    )
  })

  it('saves core habitat fields on every habitat (Reference, Type, Distinctiveness, Condition, plus Strategic Significance + Retention Category)', async () => {
    const project = await createProject('Integration test — habitat fields')
    const uploadId = await uploadFixture(FIXTURE)

    await callValidate(uploadId, { projectId: project.id })

    const stored = await fetchProject(project.id)
    for (const habitat of stored.baseline.habitats) {
      expect(habitat).toEqual(
        expect.objectContaining({
          featureId: expect.any(String),
          ref: expect.anything(),
          type: expect.anything(),
          condition: expect.anything()
        })
      )
      // distinctiveness is derived; allow null for habitat types that don't
      // appear in the lookup (real-world data isn't always pristine).
      expect(habitat).toHaveProperty('distinctiveness')
      expect(habitat).toHaveProperty('strategicSignificance')
      expect(habitat).toHaveProperty('retentionCategory')
    }
  })

  it('saves an area habitat as Incomplete when a required attribute is missing', async () => {
    const project = await createProject('Integration test - AC4 area status')
    const uploadId = await uploadFixture(NULL_AREA_CONDITION_FIXTURE)

    const res = await callValidate(uploadId, { projectId: project.id })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ valid: true, errors: [] })

    const stored = await fetchProject(project.id)
    const habitat = stored.baseline.habitats.find((h) => h.ref === 'H1')

    expect(habitat).toEqual(
      expect.objectContaining({
        ref: 'H1',
        broadType: 'Urban',
        type: 'Developed land; sealed surface',
        condition: null,
        status: 'Incomplete'
      })
    )
    expect(habitat).not.toHaveProperty('units')
  })

  it('inserts exactly one red line row in 27700 with valid geometry', async () => {
    const project = await createProject('Integration test — red line')
    const uploadId = await uploadFixture(FIXTURE)

    await callValidate(uploadId, { projectId: project.id })

    const rows = await fetchLayerRows('baseline_red_line', project.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].srid).toBe(BNG_SRID)
    expect(rows[0].is_valid).toBe(true)
    expect(rows[0].geom_type).toBe('MULTIPOLYGON')
  })
})

describe('POST /post-intervention/validate/{uploadId} - persistence and feature editing', () => {
  it('persists post-intervention data separately from baseline and supports feature read/edit', async () => {
    const project = await createProject('Integration test - post intervention')
    const uploadId = await uploadFixture(FIXTURE)

    const res = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ valid: true, errors: [] })

    const stored = await fetchProject(project.id)
    expect(stored.baseline).toBeUndefined()
    expect(stored.postIntervention).toBeDefined()
    expect(stored.postIntervention.uploadId).toBe(uploadId)
    expect(stored.postIntervention.habitats.length).toBeGreaterThan(0)
    expect(stored.postIntervention.hedgerows.length).toBeGreaterThan(0)
    expect(stored.postIntervention.watercourses.length).toBeGreaterThan(0)
    expect(stored.postIntervention.habitatSizes).toEqual(
      expect.objectContaining({
        areaHabitats: expect.any(Object),
        hedgerows: expect.any(Object),
        watercourses: expect.any(Object)
      })
    )
    expect(stored.postIntervention.units).toEqual(
      expect.objectContaining({
        habitatsTotal: expect.any(Number),
        hedgerowsTotal: expect.any(Number),
        watercoursesTotal: expect.any(Number),
        totalUnits: expect.any(Number)
      })
    )

    expect(await countLayer('baseline_habitats', project.id)).toBe(0)
    expect(await countLayer('post_intervention_red_line', project.id)).toBe(1)
    const postInterventionRows = await fetchLayerRows(
      'post_intervention_habitats',
      project.id
    )
    const docFeatureIds = stored.postIntervention.habitats.map(
      (h) => h.featureId
    )
    expect(postInterventionRows.length).toBe(docFeatureIds.length)
    expect(postInterventionRows.length).toBeGreaterThan(0)
    for (const row of postInterventionRows) {
      expect(row.srid).toBe(BNG_SRID)
      expect(row.is_valid).toBe(true)
      expect(row.geom_type).toBe('MULTIPOLYGON')
      expect(docFeatureIds).toContain(row.id)
    }

    const habitat = stored.postIntervention.habitats.find((h) => h.ref === 'H2')
    const featureRes = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}/post-intervention/features/${habitat.featureId}`,
      headers
    })
    expect(featureRes.statusCode).toBe(HTTP_OK)
    expect(featureRes.result).toEqual({
      type: 'habitat',
      feature: habitat
    })

    const updateRes = await server.inject({
      method: 'PUT',
      url: `/projects/${project.id}/post-intervention/habitats/${habitat.featureId}`,
      headers,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(updateRes.statusCode).toBe(HTTP_OK)
    expect(updateRes.result).toEqual(
      expect.objectContaining({
        featureId: habitat.featureId,
        broadType: 'Grassland',
        type: 'Lowland meadows',
        condition: 'Good',
        status: 'Complete'
      })
    )

    const updated = await fetchProject(project.id)
    expect(updated.baseline).toBeUndefined()
    expect(
      updated.postIntervention.habitats.find(
        (h) => h.featureId === habitat.featureId
      )
    ).toEqual(updateRes.result)
  })
})

describe('POST /baseline/validate/{uploadId} - persistence (per-layer feature rows)', () => {
  it('inserts one habitat row per habitat in 27700 with valid geometry, matched to the JSONB by featureId', async () => {
    const project = await createProject('Integration test — habitats')
    const uploadId = await uploadFixture(FIXTURE)

    await callValidate(uploadId, { projectId: project.id })

    const stored = await fetchProject(project.id)
    const docFeatureIds = stored.baseline.habitats.map((h) => h.featureId)
    const dbRows = await fetchLayerRows('baseline_habitats', project.id)

    expect(dbRows.length).toBe(docFeatureIds.length)
    expect(dbRows.length).toBeGreaterThan(0)
    for (const row of dbRows) {
      expect(row.srid).toBe(BNG_SRID)
      expect(row.is_valid).toBe(true)
      expect(row.geom_type).toBe('MULTIPOLYGON')
      expect(docFeatureIds).toContain(row.id)
    }
  })

  it('persists hedgerows and watercourses if present in the GeoPackage, in 27700 with MultiLineString geometry', async () => {
    const project = await createProject('Integration test — linear layers')
    const uploadId = await uploadFixture(FIXTURE)

    await callValidate(uploadId, { projectId: project.id })

    for (const table of ['baseline_hedgerows', 'baseline_watercourses']) {
      const rows = await fetchLayerRows(table, project.id)
      // Fixture may or may not contain these layers — assert shape only when present.
      for (const row of rows) {
        expect(row.srid).toBe(BNG_SRID)
        expect(row.is_valid).toBe(true)
        expect(row.geom_type).toBe('MULTILINESTRING')
      }
    }
  })
})

describe('POST /baseline/validate/{uploadId} — re-upload behaviour', () => {
  it('replaces the previous baseline rather than appending to it', async () => {
    const project = await createProject('Integration test — re-upload')
    const firstUploadId = await uploadFixture(FIXTURE)
    await callValidate(firstUploadId, { projectId: project.id })

    const firstHabitats = await countLayer('baseline_habitats', project.id)
    expect(firstHabitats).toBeGreaterThan(0)

    const secondUploadId = await uploadFixture(FIXTURE)
    await callValidate(secondUploadId, { projectId: project.id })

    const secondHabitats = await countLayer('baseline_habitats', project.id)
    const redLineCount = await countLayer('baseline_red_line', project.id)

    expect(secondHabitats).toBe(firstHabitats)
    expect(redLineCount).toBe(1)

    const stored = await fetchProject(project.id)
    expect(stored.baseline.uploadId).toBe(secondUploadId)
  })

  it('keeps featureIds fresh across re-uploads (a re-upload is a clean import, not an in-place edit)', async () => {
    const project = await createProject('Integration test — featureId churn')

    const firstUploadId = await uploadFixture(FIXTURE)
    await callValidate(firstUploadId, { projectId: project.id })
    const firstStored = await fetchProject(project.id)
    const firstIds = new Set(
      firstStored.baseline.habitats.map((h) => h.featureId)
    )

    const secondUploadId = await uploadFixture(FIXTURE)
    await callValidate(secondUploadId, { projectId: project.id })
    const secondStored = await fetchProject(project.id)
    const secondIds = new Set(
      secondStored.baseline.habitats.map((h) => h.featureId)
    )

    // No overlap — every habitat got a fresh UUID on the second import.
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false)
    }
  })
})

describe('POST /baseline/validate/{uploadId} — without a projectId', () => {
  it('validates without persisting anything', async () => {
    const project = await createProject('Integration test — no projectId')
    const uploadId = await uploadFixture(FIXTURE)

    const res = await callValidate(uploadId, undefined)

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ valid: true, errors: [] })

    const stored = await fetchProject(project.id)
    expect(stored.baseline).toBeUndefined()

    for (const table of [
      'baseline_red_line',
      'baseline_habitats',
      'baseline_hedgerows',
      'baseline_watercourses'
    ]) {
      expect(await countLayer(table, project.id)).toBe(0)
    }
  })
})

describe('POST /baseline/validate/{uploadId} — with a projectId that does not match an existing project', () => {
  it('returns 404 and persists nothing', async () => {
    const uploadId = await uploadFixture(FIXTURE)

    const res = await callValidate(uploadId, {
      projectId: UNKNOWN_PROJECT_ID
    })

    expect(res.statusCode).toBe(HTTP_NOT_FOUND)

    // No project means we can't filter by project_id; assert the unknown id
    // also has no rows (which it shouldn't, since the transaction rolled back).
    for (const table of [
      'baseline_red_line',
      'baseline_habitats',
      'baseline_hedgerows',
      'baseline_watercourses'
    ]) {
      expect(await countLayer(table, UNKNOWN_PROJECT_ID)).toBe(0)
    }
  })
})
