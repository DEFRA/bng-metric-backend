import Boom from '@hapi/boom'
import Joi from 'joi'

import { config } from '../config.js'
import {
  resolveUploadLocation,
  BASELINE_VALIDATION_CONFIG,
  POST_INTERVENTION_VALIDATION_CONFIG
} from './baseline.js'
import { createJobStore } from '../services/jobs/job-store.js'
import { HOLD_OPEN_TIMEOUT } from '../services/jobs/dispatcher.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'
import { metricsByteSize } from '../common/helpers/metrics.js'
import { GEOPACKAGE_METRIC } from '../common/helpers/metric-names.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()
const HOLD_OPEN_MS = config.get('asyncValidation.holdOpenMs')
const TERMINAL_STATUSES = ['succeeded', 'failed']

function statusUrlFor(jobId) {
  return `/baseline/jobs/${jobId}`
}

// The worker finished within the hold-open window — return its result inline
// with the same HTTP status the synchronous route would have used.
function respondInline(h, message) {
  const statusCode = message.statusCode ?? HTTP_STATUS.OK
  const body = message.result ?? {
    valid: false,
    status: message.status,
    error: message.error
  }
  return h.response(body).code(statusCode)
}

async function enqueueValidation(request, h, validationConfig) {
  const dispatcher = request.baselineDispatcher
  if (!dispatcher) {
    throw Boom.serverUnavailable('Async validation is not enabled')
  }

  const { uploadId } = request.params
  const projectId = request.payload?.projectId ?? null
  // Persisting to a project is scoped to this user's current org context.
  const { sub } = request.auth.credentials

  const { bucket, key, filename, fileSize } = await resolveUploadLocation(
    uploadId,
    validationConfig
  )
  if (fileSize != null) {
    await metricsByteSize(GEOPACKAGE_METRIC.uploadSizeBytes, fileSize)
  }

  const jobs = createJobStore(request.pg)
  const jobId = await jobs.create({
    uploadId,
    projectId,
    sub,
    mode: validationConfig.projectDocumentKey,
    bucket,
    key,
    filename,
    fileSize
  })

  dispatcher.dispatch(jobId)
  logger.info(
    `${validationConfig.routeName} - enqueued job ${jobId} for uploadId ${uploadId}`
  )

  try {
    const message = await dispatcher.waitFor(jobId, HOLD_OPEN_MS)
    if (TERMINAL_STATUSES.includes(message.status)) {
      return respondInline(h, message)
    }
    // Unexpected non-terminal message (e.g. a duplicate that was skipped): let
    // the client poll rather than guess.
    return h
      .response({
        jobId,
        status: message.status,
        statusUrl: statusUrlFor(jobId)
      })
      .code(HTTP_STATUS.ACCEPTED)
  } catch (err) {
    if (err.message === HOLD_OPEN_TIMEOUT) {
      // Slow/large file: hand the result off to polling.
      return h
        .response({
          jobId,
          status: 'processing',
          statusUrl: statusUrlFor(jobId)
        })
        .code(HTTP_STATUS.ACCEPTED)
    }
    throw err
  }
}

function createEnqueueRoute(path, validationConfig) {
  return {
    method: 'POST',
    path,
    options: {
      validate: {
        params: Joi.object({
          uploadId: Joi.string().uuid().required()
        }),
        payload: Joi.object({
          projectId: Joi.string().uuid()
        })
          .allow(null)
          .optional()
      }
    },
    handler: (request, h) => enqueueValidation(request, h, validationConfig)
  }
}

const enqueueValidateBaseline = createEnqueueRoute(
  '/baseline/validate-async/{uploadId}',
  BASELINE_VALIDATION_CONFIG
)
const enqueueValidatePostIntervention = createEnqueueRoute(
  '/post-intervention/validate-async/{uploadId}',
  POST_INTERVENTION_VALIDATION_CONFIG
)

const getBaselineJobStatus = {
  method: 'GET',
  path: '/baseline/jobs/{jobId}',
  options: {
    validate: {
      params: Joi.object({
        jobId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, h) => {
    const { jobId } = request.params
    const { sub } = request.auth.credentials
    const jobs = createJobStore(request.pg)
    const job = await jobs.get(jobId, sub)
    if (!job) {
      throw Boom.notFound('Validation job not found')
    }
    return h.response({
      jobId: job.id,
      status: job.status,
      stage: job.stage ?? undefined,
      statusCode: job.status_code ?? undefined,
      result: job.result ?? undefined,
      error: job.error ?? undefined
    })
  }
}

export {
  enqueueValidateBaseline,
  enqueueValidatePostIntervention,
  getBaselineJobStatus
}
