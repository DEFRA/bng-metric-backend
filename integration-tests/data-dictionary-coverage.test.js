// Integration read-back guard for the data dictionary.
//
// The in-process unit guard (src/validation/project-coverage.test.js) proves the
// construction code produces only schema-declared fields. This is its
// belt-and-braces companion: it drives the *real* HTTP write paths against a
// real Postgres, reads the persisted JSONB straight back out of bng.projects
// (and the bng.audit_log snapshots), and asserts every field is declared by the
// Joi schema — i.e. is documented in the generated data dictionary.
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
import { projectSchema } from '../src/validation/project.js'
import { undeclaredPaths } from '../src/validation/data-dictionary-paths.js'

const HTTP_OK = 200
const BUCKET = 'baseline-files'
const FIXTURE = 'baseline-complete.gpkg'
const UPLOAD_TIMEOUT_MS = 20_000

let server
let dbClient
const userId = `it-${randomUUID()}`

beforeAll(async () => {
  await assertCdpUploaderReachable()
  await assertLocalStackPipelineReady()
  server = await startServer()
  dbClient = await connect()
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
    payload: { project: { name }, userId }
  })
  expect(res.statusCode).toBe(HTTP_OK)
  return res.result
}

async function uploadFixture(fixtureName) {
  const initiated = await server.inject({
    method: 'POST',
    url: '/upload/initiate',
    payload: { redirect: '/done', s3Bucket: BUCKET, s3Path: 'baseline/' }
  })
  expect(initiated.statusCode).toBe(HTTP_OK)
  const { uploadId, uploadUrl } = initiated.result
  await uploadViaCdpUploader({ uploadUrl, filePath: fixturePath(fixtureName) })
  await waitForUploadStatus(server, uploadId, {
    target: 'ready',
    timeoutMs: UPLOAD_TIMEOUT_MS
  })
  return uploadId
}

async function fetchProject(id) {
  const { rows } = await dbClient.query(
    'SELECT project FROM bng.projects WHERE id = $1',
    [id]
  )
  return rows[0]?.project
}

async function fetchAuditSnapshots(projectId) {
  const { rows } = await dbClient.query(
    'SELECT project FROM bng.audit_log WHERE project_id = $1 ORDER BY audited_at',
    [projectId]
  )
  return rows.map((row) => row.project)
}

describe('data dictionary coverage — persisted JSONB matches the schema', () => {
  it('upload + habitat edit persist only schema-declared fields', async () => {
    const project = await createProject('Data dictionary coverage')
    const uploadId = await uploadFixture(FIXTURE)
    await server.inject({
      method: 'POST',
      url: `/baseline/validate/${uploadId}`,
      payload: { projectId: project.id }
    })

    // Baseline upload path.
    const afterUpload = await fetchProject(project.id)
    expect(afterUpload.baseline.habitats.length).toBeGreaterThan(0)
    expect(undeclaredPaths(afterUpload, projectSchema)).toEqual([])

    // Habitat-edit path — writes derived fields straight to the JSONB with no
    // Joi validation, so it is the most likely source of undocumented drift.
    const target = afterUpload.baseline.habitats[0]
    const editRes = await server.inject({
      method: 'PUT',
      url: `/projects/${project.id}/habitats/${target.featureId}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(editRes.statusCode).toBe(HTTP_OK)

    const afterEdit = await fetchProject(project.id)
    expect(undeclaredPaths(afterEdit, projectSchema)).toEqual([])

    const edited = afterEdit.baseline.habitats.find(
      (habitat) => habitat.featureId === target.featureId
    )
    expect(typeof edited.units).toBe('number')
    expect(edited).toHaveProperty('conditionScore')
    // The reconciliation removed habitatUnits — it must not reappear.
    expect(edited).not.toHaveProperty('habitatUnits')

    // The audit_log trigger snapshots the same document on every write.
    const snapshots = await fetchAuditSnapshots(project.id)
    expect(snapshots.length).toBeGreaterThan(0)
    for (const snapshot of snapshots) {
      expect(undeclaredPaths(snapshot, projectSchema)).toEqual([])
    }
  })
})
