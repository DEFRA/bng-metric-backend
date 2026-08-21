import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/validation-jobs/job-store.js', () => ({
  createJob: vi.fn()
}))

const { createJob } = await import('../services/validation-jobs/job-store.js')
const { validateBaselineAsync } = await import('./baseline-async.js')
const { validatePostInterventionAsync } =
  await import('./post-intervention-async.js')
const { HTTP_STATUS } = await import('../common/helpers/http/status-codes.js')

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const JOB_ID = '6f1e45b4-2e81-4c70-8a70-083ad958c913'
const CREDENTIALS = { sub: 'defra-id-sub-abc123' }

function makeH() {
  const captured = { payload: null, statusCode: HTTP_STATUS.OK }
  return {
    captured,
    response: vi.fn((payload) => {
      captured.payload = payload
      return {
        code: vi.fn((statusCode) => {
          captured.statusCode = statusCode
          return this
        })
      }
    })
  }
}

function makeRequest({ payload = null, dispatcher } = {}) {
  return {
    params: { uploadId: UPLOAD_ID },
    payload,
    auth: { credentials: CREDENTIALS },
    drizzle: { tag: 'drizzle' },
    server: { validationJobDispatcher: dispatcher }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createJob).mockResolvedValue({
    id: JOB_ID,
    status: 'pending',
    createdAt: new Date()
  })
})

describe('validateBaselineAsync handler', () => {
  it('answers 202 with the job id and where to poll', async () => {
    const h = makeH()

    await validateBaselineAsync.handler(makeRequest(), h)

    expect(h.captured.statusCode).toBe(HTTP_STATUS.ACCEPTED)
    expect(h.captured.payload).toEqual({
      jobId: JOB_ID,
      status: 'pending',
      statusUrl: `/validation-jobs/${JOB_ID}`
    })
  })

  it('does no validation work on the request', async () => {
    // The whole point: the handler records a job and returns. Anything that
    // parsed here would be back on the request loop.
    const h = makeH()

    await validateBaselineAsync.handler(makeRequest(), h)

    expect(createJob).toHaveBeenCalledTimes(1)
  })

  it('records the flow, the uploader id and the caller identity', async () => {
    const h = makeH()

    await validateBaselineAsync.handler(
      makeRequest({ payload: { projectId: PROJECT_ID } }),
      h
    )

    expect(createJob).toHaveBeenCalledWith(
      { tag: 'drizzle' },
      {
        uploadId: UPLOAD_ID,
        projectId: PROJECT_ID,
        documentKey: 'baseline',
        credentials: CREDENTIALS
      }
    )
  })

  it('treats a missing payload as validate-without-saving', async () => {
    const h = makeH()

    await validateBaselineAsync.handler(makeRequest(), h)

    expect(vi.mocked(createJob).mock.calls[0][1].projectId).toBeNull()
  })

  it('nudges the dispatcher so an idle instance starts straight away', async () => {
    const nudge = vi.fn().mockResolvedValue()
    const h = makeH()

    await validateBaselineAsync.handler(
      makeRequest({ dispatcher: { nudge } }),
      h
    )

    expect(nudge).toHaveBeenCalledTimes(1)
  })

  it('still accepts the job when the nudge fails', async () => {
    // A tick will pick the job up regardless, so a failed nudge must not lose
    // an upload the user has already made.
    const nudge = vi.fn().mockRejectedValue(new Error('dispatcher busy'))
    const h = makeH()

    await validateBaselineAsync.handler(
      makeRequest({ dispatcher: { nudge } }),
      h
    )

    expect(h.captured.statusCode).toBe(HTTP_STATUS.ACCEPTED)
  })

  it('still accepts the job on an instance with no dispatcher', async () => {
    const h = makeH()

    await validateBaselineAsync.handler(
      makeRequest({ dispatcher: undefined }),
      h
    )

    expect(h.captured.statusCode).toBe(HTTP_STATUS.ACCEPTED)
  })
})

describe('validatePostInterventionAsync handler', () => {
  it('records the post-intervention flow', async () => {
    const h = makeH()

    await validatePostInterventionAsync.handler(makeRequest(), h)

    expect(vi.mocked(createJob).mock.calls[0][1].documentKey).toBe(
      'postIntervention'
    )
  })

  it('is mounted on its own path', () => {
    expect(validatePostInterventionAsync.path).toBe(
      '/post-intervention/validate-async/{uploadId}'
    )
    expect(validateBaselineAsync.path).toBe(
      '/baseline/validate-async/{uploadId}'
    )
  })
})
