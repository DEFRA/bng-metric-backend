import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createJob,
  claimNextJob,
  completeJob,
  releaseOrFailJob,
  reapStaleJobs,
  failExhaustedJobs,
  deleteExpiredJobs,
  findJobForOwner
} from './job-store.js'
import { JOB_STATUS } from '../../db/schema/index.js'

const CREDENTIALS = { sub: 'defra-id-sub-abc123', roles: [] }
const JOB_ID = '6f1e45b4-2e81-4c70-8a70-083ad958c913'
const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'

/**
 * Minimal stand-ins for Drizzle's fluent builders. Each records what it was
 * given so the tests can assert on the query that was built, and resolves to
 * whatever the test queued up.
 */
function makeDrizzle({
  insertRows = [],
  updateRows = [],
  selectRows = [],
  executeResult = []
} = {}) {
  const calls = { values: null, set: null, executed: [] }

  const insert = vi.fn(() => ({
    values: vi.fn((values) => {
      calls.values = values
      return { returning: vi.fn(async () => insertRows) }
    })
  }))

  const update = vi.fn(() => ({
    set: vi.fn((set) => {
      calls.set = set
      const where = {
        returning: vi.fn(async () => updateRows),
        then: (resolve) => resolve(updateRows)
      }
      return { where: vi.fn(() => where) }
    })
  }))

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn(async () => selectRows) }))
    }))
  }))

  const execute = vi.fn(async (query) => {
    calls.executed.push(query)
    return executeResult
  })

  return { drizzle: { insert, update, select, execute }, calls }
}

/** Render a Drizzle sql template to its SQL text, for asserting on the query. */
function sqlTextOf(query) {
  // Static chunks carry their text in an array-valued `value`; bound
  // parameters appear as bare values and contribute no SQL.
  return query.queryChunks
    .map((chunk) => (Array.isArray(chunk?.value) ? chunk.value.join('') : ''))
    .join(' ')
}

describe('createJob', () => {
  it('records everything the pipeline will need later', async () => {
    const { drizzle, calls } = makeDrizzle({
      insertRows: [
        { id: JOB_ID, status: JOB_STATUS.pending, createdAt: new Date() }
      ]
    })

    const row = await createJob(drizzle, {
      uploadId: UPLOAD_ID,
      projectId: null,
      documentKey: 'baseline',
      credentials: CREDENTIALS,
      filename: 'baseline.gpkg',
      fileSize: 2048
    })

    expect(row.id).toBe(JOB_ID)
    // The dispatcher that runs this may be on another instance, so the row is
    // the entire handoff.
    expect(calls.values).toMatchObject({
      uploadId: UPLOAD_ID,
      documentKey: 'baseline',
      credentials: CREDENTIALS,
      status: JOB_STATUS.pending
    })
  })

  it('defaults the optional upload metadata to null', async () => {
    const { drizzle, calls } = makeDrizzle({ insertRows: [{ id: JOB_ID }] })

    await createJob(drizzle, {
      uploadId: UPLOAD_ID,
      projectId: null,
      documentKey: 'baseline',
      credentials: CREDENTIALS
    })

    expect(calls.values.filename).toBeNull()
    expect(calls.values.fileSize).toBeNull()
    expect(calls.values.projectId).toBeNull()
  })
})

describe('claimNextJob', () => {
  const claimedRow = {
    id: JOB_ID,
    upload_id: UPLOAD_ID,
    project_id: null,
    document_key: 'baseline',
    credentials: CREDENTIALS,
    filename: 'baseline.gpkg',
    file_size: '2048',
    attempts: 1
  }

  it('claims with SKIP LOCKED so two instances cannot take the same job', async () => {
    const { drizzle, calls } = makeDrizzle({
      executeResult: { rows: [claimedRow] }
    })

    await claimNextJob(drizzle, 3)

    const sql = sqlTextOf(calls.executed[0])
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql).toContain('ORDER BY created_at')
  })

  it('maps the claimed row into camelCase and numbers', async () => {
    const { drizzle } = makeDrizzle({ executeResult: { rows: [claimedRow] } })

    const job = await claimNextJob(drizzle, 3)

    expect(job).toEqual({
      id: JOB_ID,
      uploadId: UPLOAD_ID,
      projectId: null,
      documentKey: 'baseline',
      credentials: CREDENTIALS,
      filename: 'baseline.gpkg',
      // bigint arrives as a string from the driver.
      fileSize: 2048,
      attempts: 1
    })
  })

  it('returns null when nothing is waiting', async () => {
    const { drizzle } = makeDrizzle({ executeResult: { rows: [] } })

    await expect(claimNextJob(drizzle, 3)).resolves.toBeNull()
  })

  it('treats a driver response with no rows at all as no work waiting', async () => {
    const { drizzle } = makeDrizzle({ executeResult: null })

    await expect(claimNextJob(drizzle, 3)).resolves.toBeNull()
  })

  it('handles a driver that returns a bare array rather than {rows}', async () => {
    const { drizzle } = makeDrizzle({ executeResult: [claimedRow] })

    await expect(claimNextJob(drizzle, 3)).resolves.toMatchObject({
      id: JOB_ID
    })
  })

  it('leaves a null file size null rather than coercing it to zero', async () => {
    const { drizzle } = makeDrizzle({
      executeResult: { rows: [{ ...claimedRow, file_size: null }] }
    })

    await expect(claimNextJob(drizzle, 3)).resolves.toMatchObject({
      fileSize: null
    })
  })
})

describe('completeJob', () => {
  it('stores the payload the synchronous route would have returned', async () => {
    const { drizzle, calls } = makeDrizzle()

    await completeJob(drizzle, JOB_ID, { valid: true, errors: [] })

    expect(calls.set).toMatchObject({
      status: JOB_STATUS.succeeded,
      result: { valid: true, errors: [] },
      error: null
    })
    expect(calls.set.finishedAt).toBeInstanceOf(Date)
  })
})

describe('releaseOrFailJob', () => {
  it('records the failure message and clears the claim', async () => {
    const { drizzle, calls } = makeDrizzle({
      updateRows: [{ status: JOB_STATUS.pending, attempts: 1 }]
    })

    const row = await releaseOrFailJob(drizzle, JOB_ID, 'S3 timed out', 3)

    expect(calls.set.error).toBe('S3 timed out')
    // Clearing claimed_at is what lets the job be claimed again.
    expect(calls.set.claimedAt).toBeNull()
    expect(row.status).toBe(JOB_STATUS.pending)
  })
})

describe('reapStaleJobs', () => {
  it('returns jobs whose lease expired to pending', async () => {
    const { drizzle, calls } = makeDrizzle({
      executeResult: { rows: [{ id: JOB_ID }] }
    })

    const reaped = await reapStaleJobs(drizzle, 300_000)

    expect(reaped).toBe(1)
    const sql = sqlTextOf(calls.executed[0])
    expect(sql).toContain('claimed_at <')
    expect(sql).toContain('interval')
  })

  it('reports zero when nothing was stale', async () => {
    const { drizzle } = makeDrizzle({ executeResult: { rows: [] } })

    await expect(reapStaleJobs(drizzle, 300_000)).resolves.toBe(0)
  })
})

describe('failExhaustedJobs', () => {
  it('buries jobs that have used every attempt', async () => {
    // Without this they sit in pending for ever: the claim query skips them,
    // so a polling client would never see a terminal state.
    const { drizzle, calls } = makeDrizzle({
      executeResult: { rows: [{ id: JOB_ID }, { id: 'other' }] }
    })

    await expect(failExhaustedJobs(drizzle, 3)).resolves.toBe(2)
    expect(sqlTextOf(calls.executed[0])).toContain('attempts >=')
  })
})

describe('deleteExpiredJobs', () => {
  it('deletes only finished jobs past the retention window', async () => {
    const { drizzle, calls } = makeDrizzle({
      executeResult: { rows: [{ id: JOB_ID }] }
    })

    await expect(deleteExpiredJobs(drizzle, 86_400_000)).resolves.toBe(1)
    const sql = sqlTextOf(calls.executed[0])
    expect(sql).toContain('finished_at IS NOT NULL')
  })
})

describe('findJobForOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the job when it belongs to the caller', async () => {
    const { drizzle } = makeDrizzle({
      selectRows: [{ id: JOB_ID, status: 'succeeded' }]
    })

    await expect(
      findJobForOwner(drizzle, JOB_ID, CREDENTIALS.sub)
    ).resolves.toMatchObject({ id: JOB_ID })
  })

  it('returns undefined when the job is not the caller’s', async () => {
    // The route turns this into the same 404 as a job that does not exist, so
    // an id cannot be probed for existence.
    const { drizzle } = makeDrizzle({ selectRows: [] })

    await expect(
      findJobForOwner(drizzle, JOB_ID, 'someone-else')
    ).resolves.toBeUndefined()
  })
})
