import Joi from 'joi'

import { createJob } from '../services/validation-jobs/job-store.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

const logger = createLogger()

/**
 * Shared Hapi route factory for the asynchronous validate endpoints.
 *
 * The handler does no validation work at all: it records a job and returns.
 * Everything expensive happens in the dispatcher, on a worker thread, so a
 * large upload no longer holds the request loop while it parses.
 *
 * Always 202 — there is no hold-open window. A single response shape means one
 * path through the client, and the measurements behind this change put a small
 * file's parse at a few milliseconds, so an inline fast path would have saved
 * far less than the polling round-trip costs anyway.
 *
 * @param {{
 *   routeName: string,
 *   path: string,
 *   projectDocumentKey: 'baseline' | 'postIntervention',
 *   statusPathPrefix: string
 * }} config
 */
function createValidateGeoPackageAsyncRoute(config) {
  return {
    method: 'POST',
    path: config.path,
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
    handler: async (request, h) => {
      const { uploadId } = request.params
      const projectId = request.payload?.projectId ?? null
      const credentials = request.auth.credentials

      const job = await createJob(request.drizzle, {
        uploadId,
        projectId,
        documentKey: config.projectDocumentKey,
        credentials
      })

      logger.info(
        `${config.routeName} - enqueued job ${job.id} for uploadId ${uploadId}`
      )

      // Start on it now rather than at the next poll tick. Best-effort: if the
      // dispatcher is busy or absent the job still gets picked up on a tick, so
      // a failure here must not fail the enqueue.
      request.server.validationJobDispatcher?.nudge().catch((error) => {
        logger.warn(
          `${config.routeName} - could not nudge the dispatcher for job ${job.id}: ${error.message}`
        )
      })

      return h
        .response({
          jobId: job.id,
          status: job.status,
          statusUrl: `${config.statusPathPrefix}/${job.id}`
        })
        .code(HTTP_STATUS.ACCEPTED)
    }
  }
}

export { createValidateGeoPackageAsyncRoute }
