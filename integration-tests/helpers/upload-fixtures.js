import fs from 'node:fs/promises'
import path from 'node:path'
import {
  S3Client,
  HeadObjectCommand,
  HeadBucketCommand
} from '@aws-sdk/client-s3'

const FIXTURES_DIR = path.resolve(
  process.env.FIXTURES_DIR ?? 'integration-tests/fixtures'
)
export const CDP_UPLOADER_URL =
  process.env.CDP_UPLOADER_URL ?? 'http://localhost:7337'
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:4566'
const POLL_INTERVAL_MS = 500
const HTTP_BAD_REQUEST = 400
const HEALTH_CHECK_TIMEOUT_MS = 2000

function fixturePath(name) {
  return path.join(FIXTURES_DIR, name)
}

async function uploadViaCdpUploader({ uploadUrl, filePath, contentType }) {
  const fileBytes = await fs.readFile(filePath)
  const fileName = path.basename(filePath)
  const fullUrl = uploadUrl.startsWith('http')
    ? uploadUrl
    : `${CDP_UPLOADER_URL}${uploadUrl}`

  const formData = new FormData()
  formData.append(
    'file',
    new Blob([fileBytes], {
      type: contentType ?? 'application/octet-stream'
    }),
    fileName
  )

  const response = await fetch(fullUrl, {
    method: 'POST',
    body: formData,
    redirect: 'manual'
  })

  // cdp-uploader returns a 302 redirect to the configured `redirect` URL on success
  if (response.status >= HTTP_BAD_REQUEST) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Upload to cdp-uploader failed: ${response.status} ${response.statusText} ${body}`
    )
  }
}

async function waitForUploadStatus(
  server,
  uploadId,
  { target = 'ready', timeoutMs = 15_000 } = {}
) {
  const deadline = Date.now() + timeoutMs
  let lastBody
  while (Date.now() < deadline) {
    const res = await server.inject({
      method: 'GET',
      url: `/upload/${uploadId}/status`
    })
    lastBody = res.result
    if (lastBody?.uploadStatus === target) {
      return lastBody
    }
    if (lastBody?.uploadStatus === 'rejected') {
      return lastBody
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(
    `Upload ${uploadId} did not reach status '${target}' within ${timeoutMs}ms (last status: ${lastBody?.uploadStatus})`
  )
}

let s3Client
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: process.env.AWS_REGION ?? 'eu-west-2',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test'
      }
    })
  }
  return s3Client
}

async function assertS3ObjectExists(bucket, key) {
  const client = getS3Client()
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
}

async function assertCdpUploaderReachable() {
  try {
    const res = await fetch(`${CDP_UPLOADER_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
    })
    if (!res.ok) {
      throw new Error(`status ${res.status}`)
    }
  } catch (err) {
    throw new Error(
      `cdp-uploader not reachable at ${CDP_UPLOADER_URL} (${err.message}). ` +
        'Run `docker compose up -d` (or `docker compose up -d cdp-uploader`) before running these tests.'
    )
  }
}

async function assertLocalStackPipelineReady() {
  // The mock virus scan only fires if the bucket-notification + SQS queues
  // set up by compose/start-localstack.sh are in place. Without them, uploads
  // succeed but status stays at 'initiated' forever, which manifests as a 20s
  // timeout deep inside the test. Detect it here and point at the fix.
  const client = getS3Client()
  try {
    await client.send(new HeadBucketCommand({ Bucket: 'baseline-files' }))
    await client.send(
      new HeadBucketCommand({ Bucket: 'cdp-uploader-quarantine' })
    )
  } catch (err) {
    throw new Error(
      `LocalStack is missing the cdp-uploader buckets at ${S3_ENDPOINT} (${err.message}). ` +
        'Run `bash compose/start-localstack.sh` to create buckets, SQS queues, and bucket-notification wiring.'
    )
  }
}

export {
  fixturePath,
  uploadViaCdpUploader,
  waitForUploadStatus,
  assertS3ObjectExists,
  assertCdpUploaderReachable,
  assertLocalStackPipelineReady
}
