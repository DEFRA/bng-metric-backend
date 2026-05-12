import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  UPLOAD_ID,
  PROJECT_ID,
  MOCK_BUCKET,
  MOCK_KEY,
  MOCK_BUFFER,
  STUB_LAYERS,
  STUB_EXTRACTED,
  makeH,
  makeDrizzle
} from './baseline.test-fixtures.js'

vi.mock('../services/cdp-uploader/cdp-uploader.js', () => ({
  waitForUploadReady: vi.fn(),
  UploadFailedError: class MockUploadFailedError extends Error {
    constructor(message) {
      super(message)
      this.name = 'UploadFailedError'
    }
  },
  UploadTimeoutError: class MockUploadTimeoutError extends Error {
    constructor(message) {
      super(message)
      this.name = 'UploadTimeoutError'
    }
  }
}))

vi.mock('../validation/baseline/geopackage.js', () => ({
  validateGpkg: vi.fn(),
  readBaselineGeoPackage: vi.fn()
}))

vi.mock('../validation/baseline/extract-baseline.js', () => ({
  extractBaseline: vi.fn()
}))

vi.mock('../validation/baseline/index.js', () => ({
  validateBaselineLayers: vi.fn()
}))

// Preserve real error classes so instanceof checks in the handler work correctly
vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFile: vi.fn() }
})

const { waitForUploadReady } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const { downloadFile } = await import('../services/s3/download-file.js')
const { validateGpkg, readBaselineGeoPackage } =
  await import('../validation/baseline/geopackage.js')
const { extractBaseline } =
  await import('../validation/baseline/extract-baseline.js')
const { validateBaselineLayers } =
  await import('../validation/baseline/index.js')
const { ERROR_CODES, makeError } =
  await import('../validation/baseline/errors.js')
const { validateBaseline } = await import('./baseline.js')

describe('validateBaseline route configuration', () => {
  it('is a POST route', () => {
    expect(validateBaseline.method).toBe('POST')
  })

  it('has the correct path', () => {
    expect(validateBaseline.path).toBe('/baseline/validate/{uploadId}')
  })
})

describe('validateBaseline Joi param validation', () => {
  const schema = validateBaseline.options.validate.params

  it('accepts a valid UUID uploadId', () => {
    const { error } = schema.validate({ uploadId: UPLOAD_ID })
    expect(error).toBeUndefined()
  })

  it('rejects a non-UUID uploadId', () => {
    const { error } = schema.validate({ uploadId: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"uploadId" must be a valid GUID/)
  })

  it('rejects a missing uploadId', () => {
    const { error } = schema.validate({})
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"uploadId" is required/)
  })
})

describe('validateBaseline Joi payload validation', () => {
  const schema = validateBaseline.options.validate.payload

  it('accepts a missing payload', () => {
    const { error } = schema.validate(undefined)
    expect(error).toBeUndefined()
  })

  it('accepts a null payload', () => {
    const { error } = schema.validate(null)
    expect(error).toBeUndefined()
  })

  it('accepts a payload with a valid projectId', () => {
    const { error } = schema.validate({ projectId: PROJECT_ID })
    expect(error).toBeUndefined()
  })

  it('rejects a payload with a non-UUID projectId', () => {
    const { error } = schema.validate({ projectId: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toMatch(/"projectId" must be a valid GUID/)
  })
})

function setupHappyPathMocks() {
  vi.mocked(waitForUploadReady).mockResolvedValue({
    bucket: MOCK_BUCKET,
    key: MOCK_KEY
  })
  vi.mocked(downloadFile).mockResolvedValue(MOCK_BUFFER)
  vi.mocked(validateGpkg).mockReturnValue({ valid: true, errors: [] })
  vi.mocked(readBaselineGeoPackage).mockReturnValue(STUB_LAYERS)
  vi.mocked(validateBaselineLayers).mockResolvedValue({
    valid: true,
    errors: []
  })
  vi.mocked(extractBaseline).mockReturnValue(STUB_EXTRACTED)
}

function makeBaselineRequest({ drizzle, payload = null } = {}) {
  return {
    params: { uploadId: UPLOAD_ID },
    payload,
    drizzle
  }
}

describe('validateBaseline handler — pipeline calls', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
  })

  it('waits for the upload to be ready using the uploadId', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(waitForUploadReady).toHaveBeenCalledWith(UPLOAD_ID)
  })

  it('downloads the file using the resolved bucket and key', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(downloadFile).toHaveBeenCalledWith(MOCK_BUCKET, MOCK_KEY)
  })

  it('runs the gpkg gate against the downloaded buffer', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(validateGpkg).toHaveBeenCalledWith(MOCK_BUFFER)
  })

  it('runs full baseline validation when the gate passes', async () => {
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(readBaselineGeoPackage).toHaveBeenCalled()
    expect(validateBaselineLayers).toHaveBeenCalledWith(STUB_LAYERS, undefined)
  })
})

describe('validateBaseline handler — response shape', () => {
  let h
  let drizzleHarness

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    drizzleHarness = makeDrizzle()
    setupHappyPathMocks()
  })

  it('returns the baseline validation result when valid', async () => {
    const result = { valid: true, errors: [] }
    vi.mocked(validateBaselineLayers).mockResolvedValue(result)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(result)
  })

  it('returns the baseline validation result when invalid', async () => {
    const result = {
      valid: false,
      errors: [
        makeError(
          ERROR_CODES.REDLINE_INVALID_GEOMETRY,
          'Redline boundary geometry is invalid'
        )
      ]
    }
    vi.mocked(validateBaselineLayers).mockResolvedValue(result)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(result)
  })

  it('returns the gate result and skips full validation when the gate fails', async () => {
    const gateResult = {
      valid: false,
      errors: [
        makeError(
          ERROR_CODES.GPKG_MISSING_LAYER,
          'Missing required feature layer in GeoPackage: Red Line Boundary'
        )
      ]
    }
    vi.mocked(validateGpkg).mockReturnValue(gateResult)
    await validateBaseline.handler(
      makeBaselineRequest({ drizzle: drizzleHarness.drizzle }),
      h
    )
    expect(h.response).toHaveBeenCalledWith(gateResult)
    expect(validateBaselineLayers).not.toHaveBeenCalled()
  })
})
