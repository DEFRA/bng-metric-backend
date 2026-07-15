import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'

// Postgres SQLSTATE raised by the append-only guard (changelog/db.changelog-1.9.xml).
const INSUFFICIENT_PRIVILEGE = '42501'

// Every mutation the guard must reject. The seeded row is targeted by id for
// UPDATE/DELETE; TRUNCATE takes no parameters.
const BLOCKED_MUTATIONS = [
  {
    op: 'UPDATE',
    sql: "UPDATE bng.audit_log SET user_id = 'tamperer' WHERE id = $1",
    targeted: true
  },
  {
    op: 'DELETE',
    sql: 'DELETE FROM bng.audit_log WHERE id = $1',
    targeted: true
  },
  { op: 'TRUNCATE', sql: 'TRUNCATE bng.audit_log', targeted: false }
]

// bng.audit_log is an append-only audit trail: the write_audit_log trigger on
// bng.projects INSERTs a snapshot per project change, and nothing may ever edit,
// delete or wipe those rows. The guard triggers enforce that at the database
// level for every role — including this connection, which authenticates as the
// same role the application uses locally. audit-log.test.js already proves the
// legitimate append path (trigger writes on submit + rename); this file proves
// the immutability side.
describe('bng.audit_log is append-only (immutable)', () => {
  let dbClient
  let rowId
  const userId = `it-${randomUUID()}`

  beforeAll(async () => {
    dbClient = await connect()
    // Append is permitted: seed one row to attempt to tamper with. A successful
    // INSERT here is itself the proof that the guard does not block appends.
    const { rows } = await dbClient.query(
      `INSERT INTO bng.audit_log
         (project_id, project, user_id, bng_project_version, operation)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        randomUUID(),
        JSON.stringify({ name: 'immutability probe' }),
        userId,
        1,
        'INSERT'
      ]
    )
    rowId = rows[0].id
  })

  afterAll(async () => {
    // truncateTestData suspends the guard for its own connection to reset the DB.
    await truncateTestData(dbClient)
    await dbClient.end()
  })

  it('permits INSERT (append) — the seeded row exists', async () => {
    const { rows } = await dbClient.query(
      'SELECT user_id, operation FROM bng.audit_log WHERE id = $1',
      [rowId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: userId, operation: 'INSERT' })
  })

  it.each(BLOCKED_MUTATIONS)(
    'rejects $op against bng.audit_log with an append-only error',
    async ({ sql, targeted }) => {
      await expect(
        dbClient.query(sql, targeted ? [rowId] : [])
      ).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: expect.stringContaining('append-only')
      })
    }
  )

  it('leaves the seeded row intact and untampered after every blocked attempt', async () => {
    const { rows } = await dbClient.query(
      'SELECT user_id, operation FROM bng.audit_log WHERE id = $1',
      [rowId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: userId, operation: 'INSERT' })
  })
})
