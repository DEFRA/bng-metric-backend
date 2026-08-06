import { describe, it, expect, vi } from 'vitest'
import { createJobStore } from './job-store.js'

const JOB_ID = '11111111-1111-1111-1111-111111111111'
const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const SUB = 'defra-id-sub-abc123'

const HTTP_OK = 200
const HTTP_CONFLICT = 409

// A pg Pool double that records queries and replays canned responses in order.
function makePool(responses = []) {
  const calls = []
  let index = 0
  const query = vi.fn(async (text, params) => {
    calls.push({ text, params })
    return responses[index++] ?? { rows: [] }
  })
  return { pool: { query }, calls }
}

describe('createJobStore', () => {
  it('create inserts a pending row and returns the generated id', async () => {
    const { pool, calls } = makePool([{ rows: [{ id: JOB_ID }] }])
    const jobs = createJobStore(pool)

    const id = await jobs.create({
      uploadId: UPLOAD_ID,
      projectId: null,
      sub: SUB,
      mode: 'baseline',
      bucket: 'baseline-files',
      key: 'baseline/file.gpkg',
      filename: 'file.gpkg',
      fileSize: 2048
    })

    expect(id).toBe(JOB_ID)
    expect(calls[0].text).toMatch(/INSERT INTO bng\.baseline_jobs/)
    expect(calls[0].text).toMatch(/'pending'/)
    expect(calls[0].params).toEqual([
      UPLOAD_ID,
      null,
      SUB,
      'baseline',
      'baseline-files',
      'baseline/file.gpkg',
      'file.gpkg',
      2048
    ])
  })

  it('claim moves the job to processing and returns the row', async () => {
    const row = { id: JOB_ID, status: 'processing', mode: 'baseline' }
    const { pool, calls } = makePool([{ rows: [row] }])
    const jobs = createJobStore(pool)

    const claimed = await jobs.claim(JOB_ID)

    expect(claimed).toEqual(row)
    expect(calls[0].text).toMatch(/SET status = 'processing'/)
    // Only pending/failed jobs are claimable.
    expect(calls[0].params).toEqual([JOB_ID, ['pending', 'failed']])
  })

  it('claim returns null when nothing was claimable', async () => {
    const { pool } = makePool([{ rows: [] }])
    const jobs = createJobStore(pool)

    expect(await jobs.claim(JOB_ID)).toBeNull()
  })

  it('finish records a succeeded result and status code', async () => {
    const { pool, calls } = makePool([{ rows: [] }])
    const jobs = createJobStore(pool)
    const result = { valid: true }

    await jobs.finish(JOB_ID, { result, statusCode: HTTP_OK })

    expect(calls[0].text).toMatch(/SET status = 'succeeded'/)
    expect(calls[0].params).toEqual([JOB_ID, result, HTTP_OK])
  })

  it('fail records the error and status code', async () => {
    const { pool, calls } = makePool([{ rows: [] }])
    const jobs = createJobStore(pool)

    await jobs.fail(JOB_ID, { statusCode: HTTP_CONFLICT, error: 'in progress' })

    expect(calls[0].text).toMatch(/SET status = 'failed'/)
    expect(calls[0].params).toEqual([JOB_ID, HTTP_CONFLICT, 'in progress'])
  })

  it('get scopes the read to the owner', async () => {
    const row = { id: JOB_ID, status: 'succeeded' }
    const { pool, calls } = makePool([{ rows: [row] }])
    const jobs = createJobStore(pool)

    expect(await jobs.get(JOB_ID, SUB)).toEqual(row)
    expect(calls[0].text).toMatch(/user_sub = \$2/)
    expect(calls[0].params).toEqual([JOB_ID, SUB])
  })

  it('get returns null for an unknown or non-owned job', async () => {
    const { pool } = makePool([{ rows: [] }])
    const jobs = createJobStore(pool)

    expect(await jobs.get(JOB_ID, SUB)).toBeNull()
  })
})
