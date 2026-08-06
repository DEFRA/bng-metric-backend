import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runBaselineJob, configForMode } from './run-baseline-job.js'
import {
  runFullValidation,
  fetchBaselineBuffer,
  BASELINE_VALIDATION_CONFIG,
  POST_INTERVENTION_VALIDATION_CONFIG
} from '../../routes/baseline.js'
import { validateGpkg } from '../../validation/baseline/geopackage.js'
import { metricsCounter } from '../../common/helpers/metrics.js'

vi.mock('../../routes/baseline.js', () => ({
  runFullValidation: vi.fn(),
  fetchBaselineBuffer: vi.fn(),
  BASELINE_VALIDATION_CONFIG: {
    projectDocumentKey: 'baseline',
    routeName: 'validateBaseline',
    validationFailedMessage: 'Unable to validate baseline file'
  },
  POST_INTERVENTION_VALIDATION_CONFIG: {
    projectDocumentKey: 'postIntervention',
    routeName: 'validatePostIntervention',
    validationFailedMessage: 'Unable to validate post-intervention file'
  }
}))
vi.mock('../../validation/baseline/geopackage.js', () => ({
  validateGpkg: vi.fn()
}))
vi.mock('../../common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn(),
  metricsByteSize: vi.fn()
}))

const JOB_ID = '11111111-1111-1111-1111-111111111111'
const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const SUB = 'defra-id-sub-abc123'

const HTTP_OK = 200
const HTTP_TOO_LARGE = 413
const HTTP_INTERNAL = 500

function makeJob(overrides = {}) {
  return {
    id: JOB_ID,
    mode: 'baseline',
    upload_id: UPLOAD_ID,
    project_id: null,
    user_sub: SUB,
    filename: 'file.gpkg',
    file_size: 2048,
    bucket: 'baseline-files',
    s3_key: 'baseline/file.gpkg',
    ...overrides
  }
}

function makeJobs(job) {
  return {
    claim: vi.fn(async () => job),
    finish: vi.fn(async () => {}),
    fail: vi.fn(async () => {})
  }
}

function makeDeps(job) {
  return {
    jobs: makeJobs(job),
    drizzle: {},
    pgPool: {},
    logger: { info: vi.fn(), error: vi.fn() }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchBaselineBuffer.mockResolvedValue(Buffer.from('gpkg'))
})

describe('configForMode', () => {
  it('maps postIntervention to the post-intervention config', () => {
    expect(configForMode('postIntervention')).toBe(
      POST_INTERVENTION_VALIDATION_CONFIG
    )
  })

  it('defaults to the baseline config', () => {
    expect(configForMode('baseline')).toBe(BASELINE_VALIDATION_CONFIG)
    expect(configForMode(undefined)).toBe(BASELINE_VALIDATION_CONFIG)
  })
})

describe('runBaselineJob', () => {
  it('skips when the job cannot be claimed', async () => {
    const deps = makeDeps(null)

    const message = await runBaselineJob(deps, JOB_ID)

    expect(message).toEqual({ jobId: JOB_ID, status: 'skipped' })
    expect(fetchBaselineBuffer).not.toHaveBeenCalled()
  })

  it('records a definitive valid result as a succeeded job', async () => {
    const deps = makeDeps(makeJob())
    validateGpkg.mockReturnValue({ valid: true })
    runFullValidation.mockImplementation(async (_b, _d, _p, _ctx, h) => {
      h.response({ valid: true })
    })

    const message = await runBaselineJob(deps, JOB_ID)

    expect(message).toMatchObject({
      status: 'succeeded',
      statusCode: HTTP_OK,
      result: { valid: true }
    })
    expect(deps.jobs.finish).toHaveBeenCalledWith(JOB_ID, {
      result: { valid: true },
      statusCode: HTTP_OK
    })
    expect(deps.jobs.fail).not.toHaveBeenCalled()
  })

  it('records a gpkg-gate rejection as a succeeded job with the gate result', async () => {
    const deps = makeDeps(makeJob())
    const gateResult = { valid: false, errors: [{ code: 'X', message: 'bad file' }] }
    validateGpkg.mockReturnValue(gateResult)

    const message = await runBaselineJob(deps, JOB_ID)

    expect(message).toMatchObject({
      status: 'succeeded',
      statusCode: HTTP_OK,
      result: gateResult
    })
    // Never runs the heavy validation once the gate rejects.
    expect(runFullValidation).not.toHaveBeenCalled()
    expect(metricsCounter).toHaveBeenCalledTimes(1)
    expect(deps.jobs.finish).toHaveBeenCalledWith(JOB_ID, {
      result: gateResult,
      statusCode: HTTP_OK
    })
  })

  it('records an internal 500 from the pipeline as a failed job', async () => {
    const deps = makeDeps(makeJob())
    validateGpkg.mockReturnValue({ valid: true })
    runFullValidation.mockImplementation(async (_b, _d, _p, _ctx, h) => {
      h.response({ valid: false, errors: [{ message: 'kaboom' }] }).code(
        HTTP_INTERNAL
      )
    })

    const message = await runBaselineJob(deps, JOB_ID)

    expect(message).toMatchObject({ status: 'failed', statusCode: HTTP_INTERNAL })
    expect(deps.jobs.fail).toHaveBeenCalledWith(JOB_ID, {
      statusCode: HTTP_INTERNAL,
      error: 'kaboom'
    })
    expect(deps.jobs.finish).not.toHaveBeenCalled()
  })

  it('records a thrown Boom (e.g. file too large) as a failed job with its status', async () => {
    const deps = makeDeps(makeJob())
    const boom = new Error('File exceeds the maximum allowed size')
    boom.output = { statusCode: HTTP_TOO_LARGE }
    fetchBaselineBuffer.mockRejectedValue(boom)

    const message = await runBaselineJob(deps, JOB_ID)

    expect(message).toMatchObject({
      status: 'failed',
      statusCode: HTTP_TOO_LARGE,
      error: 'File exceeds the maximum allowed size'
    })
    expect(deps.jobs.fail).toHaveBeenCalledWith(JOB_ID, {
      statusCode: HTTP_TOO_LARGE,
      error: 'File exceeds the maximum allowed size'
    })
  })
})
