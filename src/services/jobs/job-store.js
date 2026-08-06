const JOBS_TABLE = 'bng.baseline_jobs'

// A job is (re)claimable while pending or after a previous transient failure.
// 'processing'/'succeeded' are never re-claimed, so a duplicate dispatch is a
// no-op rather than a double-run.
const CLAIMABLE_STATUSES = ['pending', 'failed']

// Durable store for asynchronous GeoPackage validation jobs, backed by
// bng.baseline_jobs. Constructed from a pg Pool so both request handlers
// (request.pg) and the worker thread (its own pool) can use it.
function createJobStore(pgPool) {
  return {
    async create({
      uploadId,
      projectId,
      sub,
      mode,
      bucket,
      key,
      filename,
      fileSize
    }) {
      const { rows } = await pgPool.query(
        `INSERT INTO ${JOBS_TABLE}
           (upload_id, project_id, user_sub, mode, bucket, s3_key, filename, file_size, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         RETURNING id`,
        [uploadId, projectId, sub, mode, bucket, key, filename, fileSize]
      )
      return rows[0].id
    },

    // Atomically move a job into 'processing'. The status guard means only one
    // caller can win, and a job that is already processing/succeeded returns null.
    async claim(id) {
      const { rows } = await pgPool.query(
        `UPDATE ${JOBS_TABLE}
            SET status = 'processing', started_at = now(), attempts = attempts + 1
          WHERE id = $1 AND status = ANY($2)
        RETURNING *`,
        [id, CLAIMABLE_STATUSES]
      )
      return rows[0] ?? null
    },

    async finish(id, { result, statusCode }) {
      await pgPool.query(
        `UPDATE ${JOBS_TABLE}
            SET status = 'succeeded', stage = null, result = $2,
                status_code = $3, error = null, finished_at = now()
          WHERE id = $1`,
        [id, result ?? null, statusCode ?? null]
      )
    },

    async fail(id, { statusCode, error }) {
      await pgPool.query(
        `UPDATE ${JOBS_TABLE}
            SET status = 'failed', status_code = $2, error = $3, finished_at = now()
          WHERE id = $1`,
        [id, statusCode ?? null, error ?? null]
      )
    },

    // Reads are scoped to the owner (user_sub) so a job id cannot be polled by
    // another user.
    async get(id, sub) {
      const { rows } = await pgPool.query(
        `SELECT id, status, stage, result, status_code, error
           FROM ${JOBS_TABLE}
          WHERE id = $1 AND user_sub = $2`,
        [id, sub]
      )
      return rows[0] ?? null
    }
  }
}

export { createJobStore, JOBS_TABLE, CLAIMABLE_STATUSES }
