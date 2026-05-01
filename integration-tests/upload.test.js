import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, stopServer } from './helpers/server.js'
import { config } from '../src/config.js'
import {
  fixturePath,
  uploadViaCdpUploader,
  waitForUploadStatus,
  assertS3ObjectExists,
  assertCdpUploaderReachable,
  assertLocalStackPipelineReady
} from './helpers/upload-fixtures.js'

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_BAD_GATEWAY = 502
const BUCKET = 'baseline-files'

describe('Upload routes', () => {
  let server

  beforeAll(async () => {
    await assertCdpUploaderReachable()
    await assertLocalStackPipelineReady()
    server = await startServer()
  })

  afterAll(async () => {
    await stopServer(server)
  })

  describe('POST /upload/initiate', () => {
    it('returns uploadId and uploadUrl for valid payload', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/upload/initiate',
        payload: {
          redirect: '/projects/test/upload-received',
          s3Bucket: BUCKET,
          s3Path: 'baseline/'
        }
      })
      expect(res.statusCode).toBe(HTTP_OK)
      expect(res.result.uploadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      expect(res.result.uploadUrl).toBeTruthy()
    })

    it('returns 400 when s3Bucket is missing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/upload/initiate',
        payload: { redirect: '/done' }
      })
      expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
    })

    it('returns 502 when cdp-uploader is unreachable', async () => {
      // Point to a closed port to exercise the Boom.badGateway branch.
      // Convict reads env vars only at load time, so override via config.set.
      const originalUrl = config.get('cdpUploader.url')
      config.set('cdpUploader.url', 'http://127.0.0.1:1')
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/upload/initiate',
          payload: { redirect: '/done', s3Bucket: BUCKET }
        })
        expect(res.statusCode).toBe(HTTP_BAD_GATEWAY)
      } finally {
        config.set('cdpUploader.url', originalUrl)
      }
    })
  })

  describe('GET /upload/{uploadId}/status', () => {
    it('returns 400 for a non-UUID uploadId', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/upload/not-a-uuid/status'
      })
      expect(res.statusCode).toBe(HTTP_BAD_REQUEST)
    })

    it('walks an end-to-end upload through cdp-uploader to LocalStack S3', async () => {
      const initiated = await server.inject({
        method: 'POST',
        url: '/upload/initiate',
        payload: {
          redirect: '/done',
          s3Bucket: BUCKET,
          s3Path: 'baseline/'
        }
      })
      expect(initiated.statusCode).toBe(HTTP_OK)
      const { uploadId, uploadUrl } = initiated.result

      await uploadViaCdpUploader({
        uploadUrl,
        filePath: fixturePath('baseline-complete.gpkg')
      })

      const finalStatus = await waitForUploadStatus(server, uploadId, {
        target: 'ready',
        timeoutMs: 20_000
      })
      expect(finalStatus.uploadStatus).toBe('ready')
      expect(finalStatus.numberOfRejectedFiles).toBe(0)

      // The cdp-uploader stores the file under a key derived from uploadId; the
      // exact format is opaque to us, so we discover it by listing the bucket
      // — but a HeadObject probe on the discovered key proves the file landed.
      // Easier: we fetch the s3 key from cdp-uploader's status payload.
      const statusRes = await fetch(
        `${process.env.CDP_UPLOADER_URL ?? 'http://localhost:7337'}/status/${uploadId}`
      )
      const statusJson = await statusRes.json()
      const file = statusJson.form?.file
      expect(file?.s3Bucket).toBe(BUCKET)
      expect(file?.s3Key).toBeTruthy()
      await assertS3ObjectExists(file.s3Bucket, file.s3Key)
    })
  })
})
