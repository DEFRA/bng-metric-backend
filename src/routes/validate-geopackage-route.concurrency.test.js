import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  UPLOAD_ID,
  MOCK_BUCKET,
  MOCK_KEY,
  MOCK_FILENAME,
  MOCK_FILE_SIZE,
  MOCK_DOWNLOAD_RESULT,
  STUB_LAYERS,
  makeH
} from './validate-geopackage-route.test-fixtures.js'

/**
 * One slot and almost no patience, so a second concurrent upload is turned
 * away rather than queued. The real defaults are exercised by the other route
 * tests; what matters here is the behaviour once the limit binds.
 */
const ONE_SLOT = 1
const NO_QUEUE_WAIT_MS = 1
const HTTP_503 = 503
const RETRY_AFTER_SECONDS = 30

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal()
  const overrides = {
    'validation.maxConcurrent': ONE_SLOT,
    'validation.queueTimeoutMs': NO_QUEUE_WAIT_MS
  }
  return {
    ...actual,
    config: {
      ...actual.config,
      get: (key) => (key in overrides ? overrides[key] : actual.config.get(key))
    }
  }
})

vi.mock('../services/cdp-uploader/cdp-uploader.js', () => ({
  waitForUploadReady: vi.fn(),
  UploadFailedError: class MockUploadFailedError extends Error {},
  UploadTimeoutError: class MockUploadTimeoutError extends Error {}
}))

vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFileToPath: vi.fn() }
})

vi.mock('../validation/geopackage/geopackage.js', () => ({
  validateAndReadGpkg: vi.fn()
}))

vi.mock('../validation/geopackage/index.js', () => ({
  validateGeoPackageLayers: vi.fn()
}))

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(),
  metricsByteSize: vi.fn()
}))

const { waitForUploadReady } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const { downloadFileToPath } = await import('../services/s3/download-file.js')
const { validateAndReadGpkg } =
  await import('../validation/geopackage/geopackage.js')
const { validateGeoPackageLayers } =
  await import('../validation/geopackage/index.js')
const { validateBaseline } = await import('./baseline.js')

/** A promise plus the handle to settle it, so a test can hold a slot open. */
function deferred() {
  return Promise.withResolvers()
}

function makeRequest() {
  return {
    params: { uploadId: UPLOAD_ID },
    payload: null,
    auth: { credentials: { sub: 'sub' } }
  }
}

/** Wait for already-scheduled timers, so a queued caller reaches its timeout. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(waitForUploadReady).mockResolvedValue({
    bucket: MOCK_BUCKET,
    key: MOCK_KEY,
    filename: MOCK_FILENAME,
    fileSize: MOCK_FILE_SIZE
  })
  vi.mocked(downloadFileToPath).mockResolvedValue(MOCK_DOWNLOAD_RESULT)
  vi.mocked(validateAndReadGpkg).mockReturnValue({
    valid: true,
    errors: [],
    layers: STUB_LAYERS
  })
})

describe('validate route when every validation slot is taken', () => {
  it('turns the waiting upload away with a retryable 503', async () => {
    const inFlight = deferred()
    vi.mocked(validateGeoPackageLayers).mockReturnValueOnce(inFlight.promise)

    const held = validateBaseline.handler(makeRequest(), makeH())
    await flush()
    const rejected = validateBaseline.handler(makeRequest(), makeH())

    await expect(rejected).rejects.toMatchObject({
      isBoom: true,
      output: {
        statusCode: HTTP_503,
        headers: { 'retry-after': RETRY_AFTER_SECONDS }
      }
    })

    inFlight.resolve({ valid: true, errors: [] })
    await held
  })

  it('never parses the file it turned away', async () => {
    const inFlight = deferred()
    vi.mocked(validateGeoPackageLayers).mockReturnValueOnce(inFlight.promise)

    const held = validateBaseline.handler(makeRequest(), makeH())
    await flush()
    await expect(
      validateBaseline.handler(makeRequest(), makeH())
    ).rejects.toThrow()

    // Only the upload that held the slot was ever opened.
    expect(validateAndReadGpkg).toHaveBeenCalledTimes(1)

    inFlight.resolve({ valid: true, errors: [] })
    await held
  })

  it('frees the slot again, so the next upload is validated normally', async () => {
    const inFlight = deferred()
    vi.mocked(validateGeoPackageLayers)
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValue({ valid: true, errors: [] })

    const held = validateBaseline.handler(makeRequest(), makeH())
    await flush()
    inFlight.resolve({ valid: true, errors: [] })
    await held

    await expect(
      validateBaseline.handler(makeRequest(), makeH())
    ).resolves.toBeDefined()
    expect(validateAndReadGpkg).toHaveBeenCalledTimes(2)
  })
})
