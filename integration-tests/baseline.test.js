import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, stopServer } from './helpers/server.js'
import {
  fixturePath,
  uploadViaCdpUploader,
  waitForUploadStatus,
  assertCdpUploaderReachable,
  assertLocalStackPipelineReady
} from './helpers/upload-fixtures.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const BUCKET = 'baseline-files'

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

describe('POST /baseline/validate/{uploadId}', () => {
  let server

  beforeAll(async () => {
    await assertCdpUploaderReachable()
    await assertLocalStackPipelineReady()
    server = await startServer()
  })

  afterAll(async () => {
    await stopServer(server)
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
    expect(res.result).toEqual({ valid: true, errors: [] })
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
