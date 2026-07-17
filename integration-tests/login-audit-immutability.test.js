import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { connect } from './helpers/db.js'
import { truncateTestData } from './helpers/db-cleanup.js'

// Postgres SQLSTATE raised by the append-only guard (changelog/db.changelog-1.10.xml).
const INSUFFICIENT_PRIVILEGE = '42501'

// Every mutation the guard must reject. The seeded row is targeted by id for
// UPDATE/DELETE; TRUNCATE takes no parameters.
const BLOCKED_MUTATIONS = [
  {
    op: 'UPDATE',
    sql: "UPDATE bng.login_audit SET user_id = 'tamperer' WHERE id = $1",
    targeted: true
  },
  {
    op: 'DELETE',
    sql: 'DELETE FROM bng.login_audit WHERE id = $1',
    targeted: true
  },
  { op: 'TRUNCATE', sql: 'TRUNCATE bng.login_audit', targeted: false }
]

// bng.login_audit is an append-only audit trail: the application appends one row
// per successful login (as part of the POST /auth/session workflow) and nothing
// may ever edit, delete or wipe those rows. The guard triggers enforce that at
// the database
// level for every role — including this connection, which authenticates as the
// same role the application uses locally. This file proves the immutability side:
// INSERT (append) is permitted, every other mutation is rejected.
describe('bng.login_audit is append-only (immutable)', () => {
  let dbClient
  let rowId
  const userId = `it-${randomUUID()}`

  beforeAll(async () => {
    dbClient = await connect()
    // Append is permitted: seed one row to attempt to tamper with. A successful
    // INSERT here is itself the proof that the guard does not block appends.
    const { rows } = await dbClient.query(
      `INSERT INTO bng.login_audit
         (user_id, email, first_name, last_name, current_relationship_id, session_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, 'probe@bng.test', 'Immutability', 'Probe', 'rel-1', 'sess-1']
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
      'SELECT user_id, session_id FROM bng.login_audit WHERE id = $1',
      [rowId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: userId, session_id: 'sess-1' })
  })

  it('defaults logged_in_at to a UTC timestamp on append', async () => {
    const { rows } = await dbClient.query(
      'SELECT logged_in_at FROM bng.login_audit WHERE id = $1',
      [rowId]
    )
    expect(rows[0].logged_in_at).toBeInstanceOf(Date)
  })

  it.each(BLOCKED_MUTATIONS)(
    'rejects $op against bng.login_audit with an append-only error',
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
      'SELECT user_id, session_id FROM bng.login_audit WHERE id = $1',
      [rowId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: userId, session_id: 'sess-1' })
  })
})
