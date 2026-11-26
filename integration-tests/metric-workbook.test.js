/**
 * The metric workbook download (BMD-1141), end to end: a project saved by
 * the real upload pipeline, read back from Postgres and written into each of
 * the two committed metric templates. How the rows are placed is unit tested
 * offline (project-rows.test.js); this checks the route serves the two files
 * as their types, and refuses what it should.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { skipWithServiceTemplate } from '../test/helpers/template-mode.js'

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
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404
const BUCKET = 'baseline-files'
const ZIP_MAGIC = 'PK'
// A zip names every part in its central directory, uncompressed.
const MACROS_PART = 'xl/vbaProject.bin'

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

async function createProject() {
  const created = await server.inject({
    method: 'POST',
    url: '/projects/new',
    headers,
    payload: { project: { name: 'Metric Download Site' } }
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

function getMetric(projectId, format, requestHeaders = headers) {
  return server.inject({
    method: 'GET',
    url: `/projects/${projectId}/metric.${format}`,
    headers: requestHeaders
  })
}

describe('GET /projects/{projectId}/metric.{format}', () => {
  it.for([
    ['xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', true],
    [
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      false
    ]
  ])(
    'serves the %s workbook as its own type',
    async ([format, contentType, hasMacros], { skip }) => {
      skipWithServiceTemplate(skip)
      const projectId = await createProject()
      await uploadBaseline(projectId)

      const response = await getMetric(projectId, format)

      expect(response.statusCode).toBe(HTTP_OK)
      expect(response.headers['content-type']).toBe(contentType)
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="metric.${format}"`
      )
      const bytes = response.rawPayload
      expect(bytes.subarray(0, 2).toString('latin1')).toBe(ZIP_MAGIC)
      expect(bytes.includes(MACROS_PART)).toBe(hasMacros)
    },
    60_000
  )

  it('404s for a project with no baseline uploaded yet', async () => {
    const projectId = await createProject()

    expect((await getMetric(projectId, 'xlsx')).statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('404s for a project belonging to somebody else', async () => {
    const projectId = await createProject()
    const stranger = authHeaders(await mintToken({ sub: `it-${randomUUID()}` }))

    expect((await getMetric(projectId, 'xlsx', stranger)).statusCode).toBe(
      HTTP_NOT_FOUND
    )
  })

  it('refuses a format it does not make', async () => {
    const projectId = await createProject()

    expect((await getMetric(projectId, 'xls')).statusCode).toBe(
      HTTP_BAD_REQUEST
    )
  })

  it('requires a token', async () => {
    const projectId = await createProject()

    expect((await getMetric(projectId, 'xlsm', {})).statusCode).toBe(
      HTTP_UNAUTHORIZED
    )
  })
})
