import { describe, test, expect, vi } from 'vitest'

import { insertLoginAudit } from './persist-login-audit.js'
import { loginAudit } from './schema/index.js'

// Records the insert(table).values(v).onConflictDoNothing(cfg) chain so we can
// assert the values and the session_id de-dup target without a real database.
function makeDb() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn().mockReturnValue({ onConflictDoNothing })
  const insert = vi.fn().mockReturnValue({ values })
  return { db: { insert }, insert, values, onConflictDoNothing }
}

describe('insertLoginAudit', () => {
  test('appends to loginAudit from the primary claim names, de-duped on session_id', async () => {
    const { db, insert, values, onConflictDoNothing } = makeDb()
    const claims = {
      sub: 'user-1',
      email: 'user@bng.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      sessionId: 'sess-1'
    }

    await insertLoginAudit(db, claims)

    expect(insert).toHaveBeenCalledWith(loginAudit)
    expect(values).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@bng.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      sessionId: 'sess-1'
    })
    // Repeat logins for the same session are a graceful no-op, never a DO UPDATE
    // (which the append-only guard would reject).
    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: loginAudit.sessionId
    })
  })

  test('falls back to given_name / family_name / sid', async () => {
    const { db, values } = makeDb()
    const claims = {
      sub: 'user-2',
      given_name: 'Grace',
      family_name: 'Hopper',
      sid: 'sess-2'
    }

    await insertLoginAudit(db, claims)

    expect(values).toHaveBeenCalledWith({
      userId: 'user-2',
      email: null,
      firstName: 'Grace',
      lastName: 'Hopper',
      currentRelationshipId: null,
      sessionId: 'sess-2'
    })
  })

  test('nulls every optional field when only sub is present', async () => {
    const { db, values } = makeDb()

    await insertLoginAudit(db, { sub: 'user-3' })

    expect(values).toHaveBeenCalledWith({
      userId: 'user-3',
      email: null,
      firstName: null,
      lastName: null,
      currentRelationshipId: null,
      sessionId: null
    })
  })
})
