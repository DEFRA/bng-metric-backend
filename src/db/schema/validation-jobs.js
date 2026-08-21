import {
  pgSchema,
  uuid,
  text,
  jsonb,
  integer,
  bigint,
  timestamp,
  index
} from 'drizzle-orm/pg-core'

const bng = pgSchema('bng')

/**
 * Asynchronous GeoPackage validation jobs. Transient working state, not a
 * system of record: the retention sweep in
 * `src/services/validation-jobs/job-store.js` deletes finished rows, and
 * losing one costs the user a re-upload rather than any persisted data.
 *
 * A job is claimed by exactly one instance via SELECT ... FOR UPDATE SKIP
 * LOCKED (see `claimNextJob`), so several instances share the table without
 * needing a distributed lock.
 *
 * `credentials` holds the verified Defra ID token claims of the enqueuing
 * user — claims, never the token. The worker runs outside any request and
 * cannot re-derive them, and persistence is scoped to the user's org context.
 */
const validationJobs = bng.table(
  'validation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uploadId: uuid('upload_id').notNull(),
    // Null when the caller is validating without saving to a project.
    projectId: uuid('project_id'),
    documentKey: text('document_key').notNull(),
    status: text('status').notNull().default('pending'),
    credentials: jsonb('credentials').notNull(),
    filename: text('filename'),
    fileSize: bigint('file_size', { mode: 'number' }),
    // The response body the synchronous route would have returned.
    result: jsonb('result'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('idx_validation_jobs_upload_id').on(table.uploadId),
    index('idx_validation_jobs_finished_at').on(table.finishedAt)
  ]
)

/** The states a job moves through. Mirrors ck_validation_jobs_status. */
const JOB_STATUS = Object.freeze({
  pending: 'pending',
  processing: 'processing',
  succeeded: 'succeeded',
  failed: 'failed'
})

/** Statuses from which a job will not move again. */
const TERMINAL_JOB_STATUSES = Object.freeze([
  JOB_STATUS.succeeded,
  JOB_STATUS.failed
])

export { validationJobs, JOB_STATUS, TERMINAL_JOB_STATUSES }
