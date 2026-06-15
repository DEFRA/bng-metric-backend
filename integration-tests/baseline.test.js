import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
const HTTP_BAD_REQUEST = 400
const BUCKET = 'baseline-files'

// A project seeded for these tests has a null relationship → visible to its
// owner (the token subject), so a simple no-relationship token is enough.
const seedUserId = `it-${randomUUID()}`
let headers

async function uploadFixture(server, fixtureName) {
  const initiated = await server.inject({
    method: 'POST',
    url: '/upload/initiate',
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
    timeoutMs: 20_000
  })
  return uploadId
}

async function assertHabitatSizesPersisted(server, dbClient) {
  const created = await server.inject({
    method: 'POST',
    url: '/projects/new',
    headers,
    payload: { project: { name: 'Habitat sizes test' } }
  })
  expect(created.statusCode).toBe(HTTP_OK)
  const { id: projectId } = created.result

  const uploadId = await uploadFixture(server, 'baseline-complete.gpkg')
  const res = await server.inject({
    method: 'POST',
    url: `/baseline/validate/${uploadId}`,
    payload: { projectId }
  })
  expect(res.statusCode).toBe(HTTP_OK)
  expect(res.result.valid).toBe(true)

  // habitatSizes summary — totals only, no individual arrays
  const { rows } = await dbClient.query(
    `SELECT project->'baseline'->'habitatSizes' AS habitat_sizes
       FROM bng.projects WHERE id = $1`,
    [projectId]
  )
  const habitatSizes = rows[0].habitat_sizes
  expect(habitatSizes).toEqual({
    areaHabitats: { totalSquareMetres: expect.any(Number) },
    hedgerows: { totalMetres: expect.any(Number) },
    watercourses: { totalMetres: expect.any(Number) }
  })
  expect(habitatSizes.areaHabitats.totalSquareMetres).toBeGreaterThan(0)

  // Per-feature size embedded directly in each habitat document
  const { rows: habitatRows } = await dbClient.query(
    `SELECT jsonb_array_elements(project->'baseline'->'habitats') AS habitat
       FROM bng.projects WHERE id = $1`,
    [projectId]
  )
  expect(habitatRows.length).toBeGreaterThan(0)
  for (const { habitat } of habitatRows) {
    expect(typeof habitat.sizeSquareMetres).toBe('number')
    expect(['Complete', 'Incomplete']).toContain(habitat.status)
  }

  // Status on hedgerows and watercourses
  const { rows: hedgerowRows } = await dbClient.query(
    `SELECT jsonb_array_elements(project->'baseline'->'hedgerows') AS hedgerow
       FROM bng.projects WHERE id = $1`,
    [projectId]
  )
  for (const { hedgerow } of hedgerowRows) {
    expect(['Complete', 'Incomplete']).toContain(hedgerow.status)
  }

  const { rows: watercourseRows } = await dbClient.query(
    `SELECT jsonb_array_elements(project->'baseline'->'watercourses') AS watercourse
       FROM bng.projects WHERE id = $1`,
    [projectId]
  )
  for (const { watercourse } of watercourseRows) {
    expect(['Complete', 'Incomplete']).toContain(watercourse.status)
  }
}

describe('POST /baseline/validate/{uploadId}', () => {
  let server
  let dbClient

  beforeAll(async () => {
    await assertCdpUploaderReachable()
    await assertLocalStackPipelineReady()
    server = await startServer()
    dbClient = await connect()
    headers = authHeaders(await mintToken({ sub: seedUserId }))
  })

  afterAll(async () => {
    if (dbClient) {
      await truncateTestData(dbClient)
      await dbClient.end()
    }
    if (server) {
      await stopServer(server)
    }
  })

  it('returns 400 for a non-UUID uploadId', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/baseline/validate/not-a-uuid'
    })
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
  })

  it('validates a correct GeoPackage as valid', async () => {
    const uploadId = await uploadFixture(server, 'baseline-complete.gpkg')
    const res = await server.inject({
      method: 'POST',
      url: `/baseline/validate/${uploadId}`
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.valid).toBe(true)
    expect(res.result.errors).toEqual([])
  })

  it('persists habitatSizes onto the project document when projectId is supplied', async () => {
    await assertHabitatSizesPersisted(server, dbClient)
  })

  it('reports a non-GeoPackage file as invalid', async () => {
    const uploadId = await uploadFixture(server, 'not-a-valid-geopackage.gpkg')
    const res = await server.inject({
      method: 'POST',
      url: `/baseline/validate/${uploadId}`
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.valid).toBe(false)
    expect(res.result.errors.length).toBeGreaterThan(0)
  })

  it('reports a GeoPackage missing red line boundaries as invalid', async () => {
    const uploadId = await uploadFixture(server, 'baseline-no-rlb.gpkg')
    const res = await server.inject({
      method: 'POST',
      url: `/baseline/validate/${uploadId}`
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result.valid).toBe(false)
    expect(
      res.result.errors.some((e) => /red line bound/i.test(e.message))
    ).toBe(true)
  })
})
