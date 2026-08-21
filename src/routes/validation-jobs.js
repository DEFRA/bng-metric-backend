import Boom from '@hapi/boom'
import Joi from 'joi'

import { findJobForOwner } from '../services/validation-jobs/job-store.js'
import { TERMINAL_JOB_STATUSES } from '../db/schema/index.js'

/**
 * @openapi
 * /validation-jobs/{jobId}:
 *   get:
 *     tags:
 *       - Validation
 *     summary: Poll an asynchronous GeoPackage validation job
 *     description: |
 *       Returns the job's current state. While `status` is `pending` or
 *       `processing` the client should poll again. On `succeeded` the `result`
 *       field carries exactly the body the synchronous validate route would
 *       have returned — including a rejection payload, since a file being
 *       invalid is a job that succeeded in finding that out. `failed` means the
 *       job could not be completed and the upload should be retried.
 *
 *       Scoped to the user who enqueued the job: someone else's job id is
 *       indistinguishable from one that does not exist.
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The job's current state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId: { type: string, format: uuid }
 *                 status:
 *                   type: string
 *                   enum: [pending, processing, succeeded, failed]
 *                 done:
 *                   type: boolean
 *                   description: True once status will not change again.
 *                 uploadId: { type: string, format: uuid }
 *                 projectId: { type: string, format: uuid, nullable: true }
 *                 result:
 *                   type: object
 *                   nullable: true
 *                   description: Present on success; the validate response body.
 *                 error:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: jobId is missing or not a valid UUID
 *       404:
 *         description: No such job for this user
 */
const getValidationJob = {
  method: 'GET',
  path: '/validation-jobs/{jobId}',
  options: {
    validate: {
      params: Joi.object({
        jobId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, h) => {
    const job = await findJobForOwner(
      request.drizzle,
      request.params.jobId,
      request.auth.credentials?.sub
    )
    if (!job) {
      // Deliberately the same answer for "no such job" and "not yours", so a
      // job id cannot be probed for existence.
      throw Boom.notFound('Validation job not found')
    }

    return h.response({
      jobId: job.id,
      status: job.status,
      done: TERMINAL_JOB_STATUSES.includes(job.status),
      uploadId: job.uploadId,
      projectId: job.projectId,
      result: job.result,
      error: job.error
    })
  }
}

export { getValidationJob }
