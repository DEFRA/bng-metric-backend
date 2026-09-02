import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  UPLOAD_ID,
  PROJECT_ID,
  SUB,
  MOCK_BUCKET,
  MOCK_KEY,
  MOCK_FILENAME,
  MOCK_FILE_SIZE,
  makeDownload,
  STUB_LAYERS,
  STUB_POST_INTERVENTION_EXTRACTED,
  makeH,
  makeDrizzle
} from './validate-geopackage-route.test-fixtures.js'

vi.mock('../services/cdp-uploader/cdp-uploader.js', () => ({
  waitForUploadReady: vi.fn(),
  UploadFailedError: class MockUploadFailedError extends Error {},
  UploadTimeoutError: class MockUploadTimeoutError extends Error {}
}))

vi.mock('../validation/geopackage/geopackage.js', () => ({
  validateAndReadGpkgFile: vi.fn()
}))

vi.mock('../validation/geopackage/baseline/extract-habitat-data.js', () => ({
  extractHabitatData: vi.fn()
}))

vi.mock(
  '../validation/geopackage/post-intervention/extract-post-intervention.js',
  () => ({
    extractPostIntervention: vi.fn(),
    filterLostPostInterventionLayers: vi.fn((layers) => layers)
  })
)

vi.mock(
  '../utilities/enrichment/post-intervention/enrich-post-intervention-units.js',
  () => ({
    enrichPostInterventionDocumentWithUnits: vi.fn()
  })
)

vi.mock('../validation/geopackage/assign-feature-ids.js', () => ({
  assignFeatureIds: vi.fn()
}))

vi.mock('../validation/geopackage/index.js', () => ({
  validateGeoPackageLayers: vi.fn()
}))

// Partial mock: `calculateHabitatSizes` is stubbed, but `attachGeometrySizes`
// is the real one, so the size-stamping the save path now does is exercised
// rather than replaced.
vi.mock(
  '../services/upload/calculate-habitat-sizes.js',
  async (importOriginal) => ({
    ...(await importOriginal()),
    calculateHabitatSizes: vi.fn()
  })
)

vi.mock('../utilities/enrichment/baseline/enrich-baseline-units.js', () => ({
  enrichBaselineDocumentWithUnits: vi.fn()
}))

// Preserve real error classes so instanceof checks in the handler work correctly
vi.mock('../services/s3/download-file.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downloadFileToTemp: vi.fn() }
})

vi.mock('../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(),
  metricsByteSize: vi.fn(),
  metricsMillis: vi.fn(),
  metricsGauge: vi.fn()
}))

const { waitForUploadReady } =
  await import('../services/cdp-uploader/cdp-uploader.js')
const { downloadFileToTemp } = await import('../services/s3/download-file.js')
const { validateAndReadGpkgFile } =
  await import('../validation/geopackage/geopackage.js')
const { assignFeatureIds } =
  await import('../validation/geopackage/assign-feature-ids.js')
const { extractHabitatData } =
  await import('../validation/geopackage/baseline/extract-habitat-data.js')
const { extractPostIntervention } =
  await import('../validation/geopackage/post-intervention/extract-post-intervention.js')
const { validateGeoPackageLayers } =
  await import('../validation/geopackage/index.js')
const { calculateHabitatSizes } =
  await import('../services/upload/calculate-habitat-sizes.js')
const { validatePostIntervention } = await import('./post-intervention.js')

// One SET LOCAL lock_timeout + one INSERT per non-empty geometry layer
// (red line, habitats, hedgerows, watercourses) on the stub data. The stub
// carries no individual trees, so the trees table is deleted but not inserted.
const HAPPY_PATH_EXECUTE_COUNT = 5

const EMPTY_HABITAT_SIZES = {
  areaHabitats: {
    individualSquareMetres: [],
    totalSquareMetres: 0
  },
  hedgerows: {
    individualMetres: [],
    totalMetres: 0
  },
  watercourses: {
    individualMetres: [],
    totalMetres: 0
  }
}

function setupHappyPathMocks() {
  vi.mocked(waitForUploadReady).mockResolvedValue({
    bucket: MOCK_BUCKET,
    key: MOCK_KEY,
    filename: MOCK_FILENAME,
    fileSize: MOCK_FILE_SIZE
  })
  vi.mocked(downloadFileToTemp).mockResolvedValue(makeDownload())
  vi.mocked(validateAndReadGpkgFile).mockReturnValue({
    valid: true,
    errors: [],
    layers: STUB_LAYERS
  })
  vi.mocked(validateGeoPackageLayers).mockResolvedValue({
    valid: true,
    errors: []
  })
  vi.mocked(assignFeatureIds).mockReturnValue(STUB_LAYERS)
  vi.mocked(calculateHabitatSizes).mockResolvedValue(EMPTY_HABITAT_SIZES)
  vi.mocked(extractPostIntervention).mockReturnValue(
    STUB_POST_INTERVENTION_EXTRACTED
  )
}

function makePostInterventionRequest({ drizzle, payload = null } = {}) {
  return {
    params: { uploadId: UPLOAD_ID },
    payload,
    drizzle,
    auth: { credentials: { sub: SUB } }
  }
}

describe('validatePostIntervention route configuration', () => {
  it('is a POST route for post-intervention uploads', () => {
    expect(validatePostIntervention.method).toBe('POST')
    expect(validatePostIntervention.path).toBe(
      '/post-intervention/validate/{uploadId}'
    )
  })
})

describe('validatePostIntervention handler persistence', () => {
  let h

  beforeEach(() => {
    vi.clearAllMocks()
    h = makeH()
    setupHappyPathMocks()
  })

  it('persists the processed document and replaces post-intervention geometry rows', async () => {
    const { drizzle, log } = makeDrizzle()
    const request = makePostInterventionRequest({
      drizzle,
      payload: { projectId: PROJECT_ID }
    })

    await validatePostIntervention.handler(request, h)

    expect(extractPostIntervention).toHaveBeenCalledWith(STUB_LAYERS, {
      uploadId: UPLOAD_ID,
      filename: MOCK_FILENAME,
      fileSize: MOCK_FILE_SIZE,
      habitatSizes: EMPTY_HABITAT_SIZES
    })
    expect(extractHabitatData).not.toHaveBeenCalled()
    expect(log.transactionCalls).toBe(1)
    expect(log.selectCalls).toBe(1)
    expect(log.deletes).toHaveLength(5)
    expect(log.executes).toHaveLength(HAPPY_PATH_EXECUTE_COUNT)
    expect(log.updates).toHaveLength(1)
  })
})
