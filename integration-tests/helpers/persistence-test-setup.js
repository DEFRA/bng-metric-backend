import { afterAll, afterEach, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'

import { startServer, stopServer } from './server.js'
import { connect } from './db.js'
import { truncateTestData } from './db-cleanup.js'
import {
  fixturePath,
  uploadViaCdpUploader,
  waitForUploadStatus,
  assertCdpUploaderReachable,
  assertLocalStackPipelineReady
} from './upload-fixtures.js'
import { mintToken, authHeaders } from './auth-tokens.js'
import { HTTP_OK } from './http-status.js'

export const BNG_SRID = 27700
export const BUCKET = 'baseline-files'
export const FIXTURE = 'baseline-complete.gpkg'
export const NULL_AREA_CONDITION_FIXTURE = 'baseline-null-area-condition.gpkg'

/** @type {import('@hapi/hapi').Server} */
let server
/** @type {import('pg').Client} */
let dbClient
/** @type {Record<string, string>} */
let headers
const userId = `it-${randomUUID()}`

export function getPersistenceTestContext() {
  return { server, dbClient, headers, userId }
}

export async function createProject(name) {
  const res = await server.inject({
    method: 'POST',
    url: '/projects/new',
    headers,
    payload: { project: { name } }
  })
  if (res.statusCode !== HTTP_OK) {
    throw new Error(`createProject failed: ${res.statusCode}`)
  }
  return res.result
}

export async function uploadFixture(fixtureName) {
  const initiated = await server.inject({
    method: 'POST',
    url: '/upload/initiate',
    headers,
    payload: { redirect: '/done', s3Bucket: BUCKET, s3Path: 'baseline/' }
  })
  if (initiated.statusCode !== HTTP_OK) {
    throw new Error(`upload initiate failed: ${initiated.statusCode}`)
  }
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

export async function callValidate(uploadId, payload) {
  return server.inject({
    method: 'POST',
    url: `/baseline/validate/${uploadId}`,
    headers,
    payload
  })
}

export async function callPostInterventionValidate(uploadId, payload) {
  return server.inject({
    method: 'POST',
    url: `/post-intervention/validate/${uploadId}`,
    headers,
    payload
  })
}

export async function fetchProject(id) {
  const { rows } = await dbClient.query(
    'SELECT project FROM bng.projects WHERE id = $1',
    [id]
  )
  return rows[0]?.project
}

export async function fetchProjectAudit(projectId) {
  const { rows } = await dbClient.query(
    `SELECT operation, project, previous_project, user_id, audited_at
       FROM bng.audit_log
      WHERE project_id = $1
      ORDER BY audited_at, id`,
    [projectId]
  )
  return rows
}

export async function countLayer(table, projectId) {
  const { rows } = await dbClient.query(
    `SELECT COUNT(*)::int AS c FROM bng.${table} WHERE project_id = $1`,
    [projectId]
  )
  return rows[0].c
}

export async function fetchLayerRows(table, projectId) {
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

export function registerPersistenceTestHooks() {
  beforeAll(async () => {
    await assertCdpUploaderReachable()
    await assertLocalStackPipelineReady()
    server = await startServer()
    dbClient = await connect()
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
}
