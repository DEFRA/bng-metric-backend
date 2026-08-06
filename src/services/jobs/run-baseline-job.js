import {
  runFullValidation,
  fetchBaselineBuffer,
  BASELINE_VALIDATION_CONFIG,
  POST_INTERVENTION_VALIDATION_CONFIG
} from '../../routes/baseline.js'
import { validateGpkg } from '../../validation/baseline/geopackage.js'
import { HTTP_STATUS } from '../../common/helpers/http/status-codes.js'
import { metricsCounter } from '../../common/helpers/metrics.js'
import {
  GEOPACKAGE_METRIC,
  VALIDATION_CATEGORY
} from '../../common/helpers/metric-names.js'
import { createResponseCapture } from './response-capture.js'

const POST_INTERVENTION_MODE = 'postIntervention'

// job.mode is the config.projectDocumentKey recorded at enqueue time.
function configForMode(mode) {
  return mode === POST_INTERVENTION_MODE
    ? POST_INTERVENTION_VALIDATION_CONFIG
    : BASELINE_VALIDATION_CONFIG
}

function extractErrorMessage(payload, fallback) {
  const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null
  return firstError?.message ?? fallback
}

function contextFromJob(job) {
  return {
    uploadId: job.upload_id,
    projectId: job.project_id,
    sub: job.user_sub,
    filename: job.filename,
    fileSize: job.file_size
  }
}

// Run one enqueued validation job to completion: claim it, download and validate
// the file (reusing the exact synchronous pipeline via a response-capture shim),
// and record the terminal outcome on the job row. Returns the terminal message so
// the caller (the worker thread) can notify an enqueue handler that is holding
// its response open. Free of worker_threads/Hapi so it can be unit-tested alone.
async function runBaselineJob({ jobs, drizzle, pgPool, logger }, jobId) {
  const job = await jobs.claim(jobId)
  if (!job) {
    // Already claimed, already terminal, or unknown id — nothing to do.
    return { jobId, status: 'skipped' }
  }

  const config = configForMode(job.mode)
  const context = contextFromJob(job)

  try {
    const buffer = await fetchBaselineBuffer(
      job.bucket,
      job.s3_key,
      job.upload_id,
      config
    )

    const gateResult = validateGpkg(buffer)
    if (!gateResult.valid) {
      await metricsCounter(GEOPACKAGE_METRIC.validationFailed, 1, {
        category: VALIDATION_CATEGORY.internalData
      })
      await jobs.finish(jobId, {
        result: gateResult,
        statusCode: HTTP_STATUS.OK
      })
      return {
        jobId,
        status: 'succeeded',
        statusCode: HTTP_STATUS.OK,
        result: gateResult
      }
    }

    const { h, captured } = createResponseCapture()
    await runFullValidation(buffer, drizzle, pgPool, context, h, config)
    const statusCode = captured.statusCode ?? HTTP_STATUS.OK

    // A definitive valid/invalid result returns 200; only the internal-error
    // branch of runFullValidation sets a >= 400 code, recorded as a failed job.
    if (statusCode >= HTTP_STATUS.BAD_REQUEST) {
      const message = extractErrorMessage(
        captured.payload,
        config.validationFailedMessage
      )
      await jobs.fail(jobId, { statusCode, error: message })
      return {
        jobId,
        status: 'failed',
        statusCode,
        error: message,
        result: captured.payload
      }
    }

    await jobs.finish(jobId, { result: captured.payload, statusCode })
    return { jobId, status: 'succeeded', statusCode, result: captured.payload }
  } catch (err) {
    // fetchBaselineBuffer / persist throw Boom (413/504/409/...); anything else
    // is treated as an internal failure. Either way the job is marked failed with
    // the HTTP status the synchronous route would have surfaced.
    const statusCode =
      err?.output?.statusCode ?? HTTP_STATUS.INTERNAL_SERVER_ERROR
    const message = err?.message ?? 'Validation failed'
    logger.error(err, `baseline validation job ${jobId} failed`)
    await jobs.fail(jobId, { statusCode, error: message })
    return { jobId, status: 'failed', statusCode, error: message }
  }
}

export { runBaselineJob, configForMode }
