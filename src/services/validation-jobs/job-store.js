import { and, eq, sql } from 'drizzle-orm'

import { JOB_STATUS, validationJobs } from '../../db/schema/index.js'

/**
 * Enqueue a validation job. The row is the whole handoff: the dispatcher that
 * eventually runs it may be on a different instance from the one that took the
 * upload, so everything the pipeline needs is written here.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {{
 *   uploadId: string,
 *   projectId: string | null,
 *   documentKey: 'baseline' | 'postIntervention',
 *   credentials: object,
 *   filename?: string | null,
 *   fileSize?: number | null
 * }} job
 * @returns {Promise<{ id: string, status: string, createdAt: Date }>}
 */
async function createJob(drizzle, job) {
  const [row] = await drizzle
    .insert(validationJobs)
    .values({
      uploadId: job.uploadId,
      projectId: job.projectId ?? null,
      documentKey: job.documentKey,
      credentials: job.credentials,
      filename: job.filename ?? null,
      fileSize: job.fileSize ?? null,
      status: JOB_STATUS.pending
    })
    .returning({
      id: validationJobs.id,
      status: validationJobs.status,
      createdAt: validationJobs.createdAt
    })
  return row
}

/**
 * Take the oldest pending job, if there is one.
 *
 * The sub-select takes a row lock and SKIP LOCKED steps over rows another
 * instance is already claiming, so two dispatchers racing cannot both win the
 * same job — and neither blocks waiting for the other. One statement, so no
 * explicit transaction is needed.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {number} maxAttempts jobs that have already burned this many attempts
 *   are left alone for {@link failExhaustedJobs} to bury
 * @returns {Promise<object | null>}
 */
async function claimNextJob(drizzle, maxAttempts) {
  const claimed = await drizzle.execute(sql`
    UPDATE bng.validation_jobs
       SET status = ${JOB_STATUS.processing},
           attempts = attempts + 1,
           claimed_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id
         FROM bng.validation_jobs
        WHERE status = ${JOB_STATUS.pending}
          AND attempts < ${maxAttempts}
        ORDER BY created_at
          FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING id, upload_id, project_id, document_key, credentials,
               filename, file_size, attempts
  `)
  const [row] = rowsOf(claimed)
  return row ? toClaimedJob(row) : null
}

/**
 * Drizzle's execute returns the driver result on some versions and a bare array
 * on others; normalise so callers do not have to care.
 */
function rowsOf(result) {
  if (Array.isArray(result)) {
    return result
  }
  return result?.rows ?? []
}

function toClaimedJob(row) {
  return {
    id: row.id,
    uploadId: row.upload_id,
    projectId: row.project_id,
    documentKey: row.document_key,
    credentials: row.credentials,
    filename: row.filename,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    attempts: row.attempts
  }
}

/**
 * Record a finished job. `result` is the response body the synchronous route
 * would have returned, so a polling client gets the same shape either way.
 */
async function completeJob(drizzle, jobId, result) {
  await drizzle
    .update(validationJobs)
    .set({
      status: JOB_STATUS.succeeded,
      result,
      error: null,
      finishedAt: new Date()
    })
    .where(eq(validationJobs.id, jobId))
}

/**
 * Hand a job back for another attempt, or bury it if it has run out.
 * Returning it to `pending` is what makes a transient failure retryable
 * without a separate retry queue.
 */
async function releaseOrFailJob(drizzle, jobId, message, maxAttempts) {
  const [row] = await drizzle
    .update(validationJobs)
    .set({
      status: sql`CASE WHEN ${validationJobs.attempts} >= ${maxAttempts}
                       THEN ${JOB_STATUS.failed}
                       ELSE ${JOB_STATUS.pending} END`,
      error: message,
      finishedAt: sql`CASE WHEN ${validationJobs.attempts} >= ${maxAttempts}
                           THEN CURRENT_TIMESTAMP
                           ELSE NULL END`,
      claimedAt: null
    })
    .where(eq(validationJobs.id, jobId))
    .returning({
      status: validationJobs.status,
      attempts: validationJobs.attempts
    })
  return row
}

/**
 * Return jobs whose worker died holding them. A row sitting in `processing`
 * past its lease has no live owner — the instance was redeployed, OOM-killed,
 * or lost its database connection — so it goes back on the queue.
 *
 * @returns {Promise<number>} how many jobs were recovered
 */
async function reapStaleJobs(drizzle, leaseMs) {
  const reaped = await drizzle.execute(sql`
    UPDATE bng.validation_jobs
       SET status = ${JOB_STATUS.pending},
           claimed_at = NULL,
           error = 'Reclaimed after the worker stopped reporting'
     WHERE status = ${JOB_STATUS.processing}
       AND claimed_at < CURRENT_TIMESTAMP - ${`${leaseMs} milliseconds`}::interval
     RETURNING id
  `)
  return rowsOf(reaped).length
}

/**
 * Bury jobs that have used up every attempt. The claim query skips them, so
 * without this they would sit in `pending` for ever and a polling client would
 * never see a terminal state.
 *
 * @returns {Promise<number>} how many jobs were buried
 */
async function failExhaustedJobs(drizzle, maxAttempts) {
  const failed = await drizzle.execute(sql`
    UPDATE bng.validation_jobs
       SET status = ${JOB_STATUS.failed},
           finished_at = CURRENT_TIMESTAMP,
           error = COALESCE(error, 'Validation failed')
     WHERE status = ${JOB_STATUS.pending}
       AND attempts >= ${maxAttempts}
     RETURNING id
  `)
  return rowsOf(failed).length
}

/**
 * Delete finished jobs past their retention window. Housekeeping, but also
 * data minimisation: a job row holds the enqueuing user's token claims.
 *
 * @returns {Promise<number>} how many jobs were deleted
 */
async function deleteExpiredJobs(drizzle, retentionMs) {
  const deleted = await drizzle.execute(sql`
    DELETE FROM bng.validation_jobs
     WHERE finished_at IS NOT NULL
       AND finished_at < CURRENT_TIMESTAMP - ${`${retentionMs} milliseconds`}::interval
     RETURNING id
  `)
  return rowsOf(deleted).length
}

/**
 * Read a job back for its owner. Scoped by the `sub` recorded at enqueue time,
 * so one user cannot poll another's job by guessing its id.
 *
 * @returns {Promise<object | undefined>} undefined when the job does not exist
 *   OR belongs to someone else — the caller must not distinguish the two
 */
async function findJobForOwner(drizzle, jobId, sub) {
  const [row] = await drizzle
    .select({
      id: validationJobs.id,
      uploadId: validationJobs.uploadId,
      projectId: validationJobs.projectId,
      status: validationJobs.status,
      result: validationJobs.result,
      error: validationJobs.error,
      createdAt: validationJobs.createdAt,
      finishedAt: validationJobs.finishedAt
    })
    .from(validationJobs)
    .where(
      and(
        eq(validationJobs.id, jobId),
        sql`${validationJobs.credentials}->>'sub' = ${sub}`
      )
    )
    .limit(1)
  return row
}

export {
  createJob,
  claimNextJob,
  completeJob,
  releaseOrFailJob,
  reapStaleJobs,
  failExhaustedJobs,
  deleteExpiredJobs,
  findJobForOwner
}
