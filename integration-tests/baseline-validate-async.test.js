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
const HTTP_ACCEPTED = 202
const HTTP_NOT_FOUND = 404
const BUCKET = 'baseline-files'

const JOB_POLL_INTERVAL_MS = 100
const JOB_POLL_TIMEOUT_MS = 60_000

const seedUserId = `it-${randomUUID()}`
let headers
let server
let dbClient

async function uploadFixture(fixtureName) {
  const initiated = await server.inject({
    method: 'POST',
    url: '/upload/initiate',
    headers,
    payload: { redirect: '/done', s3Bucket: BUCKET, s3Path: 'baseline/' }
  })
  expect(initiated.statusCode).toBe(HTTP_OK)
  const { uploadId, uploadUrl } = initiated.result
  await uploadViaCdpUploader({ uploadUrl, filePath: fixturePath(fixtureName) })
  await waitForUploadStatus(server, uploadId, {
    target: 'ready',
    timeoutMs: 20_000,
    headers
  })
  return uploadId
}

/** Poll the status route the way the frontend will, until the job settles. */
async function pollUntilDone(jobId, pollHeaders = headers) {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS
  let last
  while (Date.now() < deadline) {
    const res = await server.inject({
      method: 'GET',
      url: `/validation-jobs/${jobId}`,
      headers: pollHeaders
    })
    expect(res.statusCode).toBe(HTTP_OK)
    last = res.result
    if (last.done) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS))
  }
  throw new Error(
    `Validation job ${jobId} never reached a terminal state (last status: ${last?.status})`
  )
}

async function enqueue(uploadId, payload) {
  const res = await server.inject({
    method: 'POST',
    url: `/baseline/validate-async/${uploadId}`,
    headers,
    payload
  })
  expect(res.statusCode).toBe(HTTP_ACCEPTED)
  return res.result
}

beforeAll(async () => {
  server = await startServer()
  dbClient = await connect()
  headers = authHeaders(await mintToken({ sub: seedUserId }))
  await assertCdpUploaderReachable()
  await assertLocalStackPipelineReady()
})

afterAll(async () => {
  await truncateTestData(dbClient)
  await dbClient?.end()
  await stopServer(server)
})

describe('POST /baseline/validate-async — enqueue and poll', () => {
  it('accepts the upload immediately and validates it off the request', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/projects/new',
      headers,
      payload: { project: { name: 'Async validation test' } }
    })
    expect(created.statusCode).toBe(HTTP_OK)
    const { id: projectId } = created.result

    const uploadId = await uploadFixture('baseline-complete.gpkg')
    const accepted = await enqueue(uploadId, { projectId })

    expect(accepted).toMatchObject({
      jobId: expect.any(String),
      status: 'pending',
      statusUrl: `/validation-jobs/${accepted.jobId}`
    })

    const finished = await pollUntilDone(accepted.jobId)

    expect(finished.status).toBe('succeeded')
    // The payload is exactly what the synchronous route returns, so the client
    // has one outcome shape to handle whichever path produced it.
    expect(finished.result.valid).toBe(true)
    expect(finished.uploadId).toBe(uploadId)

    // And the job really did the whole pipeline, not just the parse.
    const { rows } = await dbClient.query(
      `SELECT project->'baseline'->'uploadId' AS upload_id
         FROM bng.projects WHERE id = $1`,
      [projectId]
    )
    expect(rows[0].upload_id).toBe(uploadId)
  })

  it('validates without a project when none is named', async () => {
    const uploadId = await uploadFixture('baseline-complete.gpkg')
    const accepted = await enqueue(uploadId, null)

    const finished = await pollUntilDone(accepted.jobId)

    expect(finished.status).toBe('succeeded')
    expect(finished.result.valid).toBe(true)
    expect(finished.projectId).toBeNull()
  })

  it('reports a rejected file as a succeeded job carrying the errors', async () => {
    // The job succeeded in establishing the file is invalid. A client must
    // read result.valid, not job status, to decide what to tell the user.
    const uploadId = await uploadFixture('not-a-valid-geopackage.gpkg')
    const accepted = await enqueue(uploadId, null)

    const finished = await pollUntilDone(accepted.jobId)

    expect(finished.status).toBe('succeeded')
    expect(finished.result.valid).toBe(false)
    expect(finished.result.errors.length).toBeGreaterThan(0)
  })

  it('records the job against the enqueuing user', async () => {
    const uploadId = await uploadFixture('baseline-complete.gpkg')
    const accepted = await enqueue(uploadId, null)

    const { rows } = await dbClient.query(
      `SELECT credentials->>'sub' AS sub, document_key
         FROM bng.validation_jobs WHERE id = $1`,
      [accepted.jobId]
    )
    expect(rows[0]).toMatchObject({ sub: seedUserId, document_key: 'baseline' })
  })
})

describe('POST /post-intervention/validate-async — enqueue', () => {
  it('records a post-intervention job against the same queue', async () => {
    // The enqueue route does no validation, so this asserts the handoff only:
    // the flow is recorded so the worker later runs the right pipeline.
    const uploadId = await uploadFixture('baseline-complete.gpkg')

    const res = await server.inject({
      method: 'POST',
      url: `/post-intervention/validate-async/${uploadId}`,
      headers,
      payload: null
    })

    expect(res.statusCode).toBe(HTTP_ACCEPTED)
    const { rows } = await dbClient.query(
      `SELECT document_key FROM bng.validation_jobs WHERE id = $1`,
      [res.result.jobId]
    )
    expect(rows[0].document_key).toBe('postIntervention')
  })
})

describe('GET /validation-jobs/{jobId} — ownership', () => {
  it('hides another user’s job behind the same 404 as one that does not exist', async () => {
    const uploadId = await uploadFixture('baseline-complete.gpkg')
    const accepted = await enqueue(uploadId, null)
    const otherHeaders = authHeaders(
      await mintToken({ sub: `it-other-${randomUUID()}` })
    )

    const res = await server.inject({
      method: 'GET',
      url: `/validation-jobs/${accepted.jobId}`,
      headers: otherHeaders
    })

    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })

  it('404s for a job id that was never issued', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/validation-jobs/${randomUUID()}`,
      headers
    })

    expect(res.statusCode).toBe(HTTP_NOT_FOUND)
  })
})
