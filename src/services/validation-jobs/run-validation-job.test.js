import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../cdp-uploader/cdp-uploader.js', () => ({
  waitForUploadReady: vi.fn()
}))
vi.mock('../s3/download-file.js', () => ({ downloadFile: vi.fn() }))
vi.mock('./run-parse-in-worker.js', () => ({ runParseInWorker: vi.fn() }))
vi.mock('../upload/validate-layers-and-save.js', () => ({
  respondToGateRejection: vi.fn(),
  validateLayersAndSave: vi.fn()
}))
vi.mock('../../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(),
  metricsByteSize: vi.fn()
}))

const { waitForUploadReady } = await import('../cdp-uploader/cdp-uploader.js')
const { downloadFile } = await import('../s3/download-file.js')
const { runParseInWorker } = await import('./run-parse-in-worker.js')
const { respondToGateRejection, validateLayersAndSave } =
  await import('../upload/validate-layers-and-save.js')
const { metricsByteSize } = await import('../../common/helpers/metrics.js')
const { runValidationJob } = await import('./run-validation-job.js')

const DEPS = { drizzle: { tag: 'drizzle' }, pgPool: { tag: 'pool' } }
const BUFFER = Buffer.from('gpkg-bytes')
const STUB_LAYERS = { redline: [], areas: [] }

function makeJob(overrides = {}) {
  return {
    id: '6f1e45b4-2e81-4c70-8a70-083ad958c913',
    uploadId: 'f6b667d8-998f-4f55-8a20-204c0c289147',
    projectId: null,
    documentKey: 'baseline',
    credentials: { sub: 'sub-1' },
    filename: null,
    fileSize: null,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(waitForUploadReady).mockResolvedValue({
    bucket: 'baseline-files',
    key: 'baseline/file.gpkg',
    filename: 'my-baseline.gpkg',
    fileSize: 2048
  })
  vi.mocked(downloadFile).mockResolvedValue(BUFFER)
  vi.mocked(runParseInWorker).mockResolvedValue({
    valid: true,
    errors: [],
    layers: STUB_LAYERS
  })
  // The real pipeline answers through the toolkit; mirror that.
  vi.mocked(validateLayersAndSave).mockImplementation(
    async (_layers, _drizzle, _pool, _context, h) =>
      h.response({ valid: true, errors: [] })
  )
  vi.mocked(respondToGateRejection).mockImplementation(
    async (gateResult, _uploadId, h) =>
      h.response({ valid: false, errors: gateResult.errors })
  )
})

describe('runValidationJob', () => {
  it('parses on a worker thread, not the request loop', async () => {
    await runValidationJob(DEPS, makeJob())

    // The point of the story: the parse goes through the worker runner.
    expect(runParseInWorker).toHaveBeenCalledWith(BUFFER)
  })

  it('returns the same payload the synchronous route would have', async () => {
    const captured = await runValidationJob(DEPS, makeJob())

    expect(captured).toEqual({
      statusCode: 200,
      payload: { valid: true, errors: [] }
    })
  })

  it('stops at the gate when the file is not a valid GeoPackage', async () => {
    vi.mocked(runParseInWorker).mockResolvedValue({
      valid: false,
      errors: [{ code: 'GPKG_INVALID_FILE', message: 'nope' }],
      layers: null
    })

    const captured = await runValidationJob(DEPS, makeJob())

    expect(respondToGateRejection).toHaveBeenCalled()
    expect(validateLayersAndSave).not.toHaveBeenCalled()
    expect(captured.payload).toEqual({
      valid: false,
      errors: [{ code: 'GPKG_INVALID_FILE', message: 'nope' }]
    })
  })

  it('passes the job credentials through so the save is scoped to the user', async () => {
    // The worker runs outside any request, so the only identity available is
    // the one recorded at enqueue time.
    const job = makeJob({ projectId: 'project-1' })

    await runValidationJob(DEPS, job)

    const [, drizzle, pgPool, context] = vi.mocked(validateLayersAndSave).mock
      .calls[0]
    expect(drizzle).toBe(DEPS.drizzle)
    expect(pgPool).toBe(DEPS.pgPool)
    expect(context).toMatchObject({
      projectId: 'project-1',
      credentials: { sub: 'sub-1' }
    })
  })

  it('prefers the uploader metadata over what was recorded at enqueue time', async () => {
    await runValidationJob(
      DEPS,
      makeJob({ filename: 'stale.gpkg', fileSize: 1 })
    )

    const [, , , context] = vi.mocked(validateLayersAndSave).mock.calls[0]
    expect(context.filename).toBe('my-baseline.gpkg')
    expect(context.fileSize).toBe(2048)
  })

  it('falls back to the recorded metadata when the uploader reports none', async () => {
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: 'b',
      key: 'k',
      filename: null,
      fileSize: null
    })

    await runValidationJob(
      DEPS,
      makeJob({ filename: 'recorded.gpkg', fileSize: 99 })
    )

    const [, , , context] = vi.mocked(validateLayersAndSave).mock.calls[0]
    expect(context.filename).toBe('recorded.gpkg')
    expect(context.fileSize).toBe(99)
  })

  it('emits the upload size metric', async () => {
    await runValidationJob(DEPS, makeJob())

    expect(metricsByteSize).toHaveBeenCalledWith(expect.any(String), 2048)
  })

  it('skips the size metric when the uploader reports no size', async () => {
    vi.mocked(waitForUploadReady).mockResolvedValue({
      bucket: 'b',
      key: 'k',
      filename: 'f.gpkg',
      fileSize: null
    })

    await runValidationJob(DEPS, makeJob())

    expect(metricsByteSize).not.toHaveBeenCalled()
  })

  it('propagates a download failure so the job is retried', async () => {
    // Distinct from an invalid file: nothing was learned, so the dispatcher
    // must hand the job back rather than record a result.
    vi.mocked(downloadFile).mockRejectedValue(new Error('S3 timed out'))

    await expect(runValidationJob(DEPS, makeJob())).rejects.toThrow(
      'S3 timed out'
    )
  })

  it('propagates a worker crash so the job is retried', async () => {
    vi.mocked(runParseInWorker).mockRejectedValue(
      new Error('Validation worker exited unexpectedly with code 1')
    )

    await expect(runValidationJob(DEPS, makeJob())).rejects.toThrow(
      /worker exited/
    )
  })

  it('rejects a job whose document key has no pipeline', async () => {
    await expect(
      runValidationJob(DEPS, makeJob({ documentKey: 'nonsense' }))
    ).rejects.toThrow(/Unsupported validation documentKey/)
  })
})
