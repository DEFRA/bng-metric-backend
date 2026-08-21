import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/validation-jobs/job-store.js', () => ({
  findJobForOwner: vi.fn()
}))

const { findJobForOwner } =
  await import('../services/validation-jobs/job-store.js')
const { getValidationJob } = await import('./validation-jobs.js')

const JOB_ID = '6f1e45b4-2e81-4c70-8a70-083ad958c913'
const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const SUB = 'defra-id-sub-abc123'

function makeH() {
  const captured = { payload: null }
  return {
    captured,
    response: vi.fn((payload) => {
      captured.payload = payload
      return payload
    })
  }
}

function makeRequest() {
  return {
    params: { jobId: JOB_ID },
    auth: { credentials: { sub: SUB } },
    drizzle: { tag: 'drizzle' }
  }
}

function jobRow(overrides = {}) {
  return {
    id: JOB_ID,
    uploadId: UPLOAD_ID,
    projectId: null,
    status: 'pending',
    result: null,
    error: null,
    createdAt: new Date(),
    finishedAt: null,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getValidationJob', () => {
  it('reports a job still in flight as not done', async () => {
    vi.mocked(findJobForOwner).mockResolvedValue(
      jobRow({ status: 'processing' })
    )
    const h = makeH()

    await getValidationJob.handler(makeRequest(), h)

    expect(h.captured.payload).toMatchObject({
      jobId: JOB_ID,
      status: 'processing',
      done: false,
      result: null
    })
  })

  it('returns the validate payload once the job succeeds', async () => {
    vi.mocked(findJobForOwner).mockResolvedValue(
      jobRow({ status: 'succeeded', result: { valid: true, errors: [] } })
    )
    const h = makeH()

    await getValidationJob.handler(makeRequest(), h)

    expect(h.captured.payload).toMatchObject({
      done: true,
      result: { valid: true, errors: [] }
    })
  })

  it('reports a rejected file as a succeeded job carrying the errors', async () => {
    // The job succeeded in establishing the file is invalid; that is not a
    // failed job, and the client must not retry it.
    vi.mocked(findJobForOwner).mockResolvedValue(
      jobRow({
        status: 'succeeded',
        result: { valid: false, errors: [{ code: 'GPKG_INVALID_FILE' }] }
      })
    )
    const h = makeH()

    await getValidationJob.handler(makeRequest(), h)

    expect(h.captured.payload.done).toBe(true)
    expect(h.captured.payload.result.valid).toBe(false)
  })

  it('reports a failed job as done, with its error', async () => {
    vi.mocked(findJobForOwner).mockResolvedValue(
      jobRow({ status: 'failed', error: 'S3 timed out' })
    )
    const h = makeH()

    await getValidationJob.handler(makeRequest(), h)

    expect(h.captured.payload).toMatchObject({
      status: 'failed',
      done: true,
      error: 'S3 timed out'
    })
  })

  it('scopes the lookup to the caller', async () => {
    vi.mocked(findJobForOwner).mockResolvedValue(jobRow())
    const h = makeH()

    await getValidationJob.handler(makeRequest(), h)

    expect(findJobForOwner).toHaveBeenCalledWith(
      { tag: 'drizzle' },
      JOB_ID,
      SUB
    )
  })

  it('404s for a job belonging to someone else, exactly as for one that does not exist', async () => {
    vi.mocked(findJobForOwner).mockResolvedValue(undefined)

    await expect(
      getValidationJob.handler(makeRequest(), makeH())
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 404 }
    })
  })
})
