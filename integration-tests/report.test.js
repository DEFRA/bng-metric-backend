/**
 * The site report, end to end against real PostGIS.
 *
 * The part worth an integration test is the part unit tests cannot reach: the
 * geometry the report draws comes back out of `geometry(..., 27700)` columns
 * through `ST_AsGeoJSON`, joined to the project document by featureId. Every
 * other stage is exercised offline.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startServer, stopServer } from './helpers/server.js'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'
import {
  assertCdpUploaderReachable,
  assertLocalStackPipelineReady,
  fixturePath,
  uploadViaCdpUploader,
  waitForUploadStatus
} from './helpers/upload-fixtures.js'
import { authHeaders, mintToken } from './helpers/auth-tokens.js'

const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404
const BUCKET = 'baseline-files'
const PDF_MAGIC = '%PDF-'

const seedUserId = `it-${randomUUID()}`
let server
let dbClient
let headers

beforeAll(async () => {
  await assertCdpUploaderReachable()
  await assertLocalStackPipelineReady()
  server = await startServer()
  dbClient = await connect()
  headers = authHeaders(await mintToken({ sub: seedUserId }))
  await truncateTestData(dbClient)
}, 60_000)

afterAll(async () => {
  await dbClient?.end()
  await stopServer(server)
})

async function createProject(name = 'Report Test Site') {
  const created = await server.inject({
    method: 'POST',
    url: '/projects/new',
    headers,
    payload: { project: { name } }
  })
  expect(created.statusCode).toBe(HTTP_OK)
  return created.result.id
}

async function uploadBaseline(projectId) {
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
    filePath: fixturePath('baseline-complete.gpkg')
  })
  await waitForUploadStatus(server, uploadId, {
    target: 'ready',
    timeoutMs: 20_000,
    headers
  })

  const validated = await server.inject({
    method: 'POST',
    url: `/baseline/validate/${uploadId}`,
    headers,
    payload: { projectId }
  })
  expect(validated.statusCode).toBe(HTTP_OK)
}

function getReport(projectId, requestHeaders = headers) {
  return server.inject({
    method: 'GET',
    url: `/projects/${projectId}/report.pdf`,
    headers: requestHeaders
  })
}

describe('GET /projects/{projectId}/report.pdf', () => {
  it('renders a PDF from the geometry stored in PostGIS', async () => {
    const projectId = await createProject()
    await uploadBaseline(projectId)

    const response = await getReport(projectId)

    expect(response.statusCode).toBe(HTTP_OK)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toContain('attachment')
    expect(response.rawPayload.subarray(0, 5).toString('latin1')).toBe(
      PDF_MAGIC
    )

    // A report drawn from real geometry is substantially larger than the
    // handful of kilobytes an empty document would be — this is the assertion
    // that the parcels actually reached the page.
    expect(response.rawPayload.length).toBeGreaterThan(20_000)
  }, 60_000)

  it('names the file after the site', async () => {
    const projectId = await createProject('Willow Brook Farm')
    await uploadBaseline(projectId)

    const response = await getReport(projectId)

    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="Willow Brook Farm-report.pdf"'
    )
  }, 60_000)

  it('404s for a project with no baseline uploaded yet', async () => {
    const projectId = await createProject()

    expect((await getReport(projectId)).statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('404s for a project belonging to somebody else', async () => {
    const projectId = await createProject()
    await uploadBaseline(projectId)
    const stranger = authHeaders(await mintToken({ sub: `it-${randomUUID()}` }))

    // Indistinguishable from a missing project, by design.
    expect((await getReport(projectId, stranger)).statusCode).toBe(
      HTTP_NOT_FOUND
    )
  }, 60_000)

  it('requires a token', async () => {
    const projectId = await createProject()

    expect((await getReport(projectId, {})).statusCode).toBe(HTTP_UNAUTHORIZED)
  })
})
