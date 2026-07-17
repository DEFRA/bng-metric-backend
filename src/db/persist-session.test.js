import { describe, test, expect, vi } from 'vitest'

import { persistSession } from './persist-session.js'
import { users, relationships, roles, loginAudit } from './schema/index.js'

// Records every insert(table).values(v).onConflict*(cfg) chain issued inside the
// transaction so we can assert the upserts (onConflictDoUpdate) and the
// append-only login_audit insert (onConflictDoNothing) without a real database.
function makeTx() {
  const calls = []
  const insert = vi.fn((table) => ({
    values: vi.fn((values) => ({
      onConflictDoUpdate: vi.fn((conflict) => {
        calls.push({ table, values, conflict })
        return Promise.resolve()
      }),
      onConflictDoNothing: vi.fn((conflict) => {
        calls.push({ table, values, conflict })
        return Promise.resolve()
      })
    }))
  }))
  return { insert, calls }
}

function makeDrizzle(tx) {
  return {
    transaction: vi.fn(async (cb) => cb(tx))
  }
}

const SUB = 'user-sub-123'

function callsFor(tx, table) {
  return tx.calls.filter((c) => c.table === table)
}

describe('persistSession', () => {
  test('upserts one user, N relationships and M roles in a transaction', async () => {
    const tx = makeTx()
    const drizzle = makeDrizzle(tx)
    const claims = {
      sub: SUB,
      email: 'a@b.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      relationships: [
        'rel-1:org-1:Acme Ltd:0:Employee:1',
        'rel-2:org-2:Globex:0:Agent:1'
      ],
      roles: ['rel-1:bng completer:3', 'rel-2:bng viewer:1']
    }

    await persistSession(drizzle, claims)

    expect(drizzle.transaction).toHaveBeenCalledTimes(1)
    expect(callsFor(tx, users)).toHaveLength(1)
    expect(callsFor(tx, relationships)).toHaveLength(2)
    expect(callsFor(tx, roles)).toHaveLength(2)
  })

  test('writes the expected user identity and targets the user_id conflict', async () => {
    const tx = makeTx()
    await persistSession(makeDrizzle(tx), {
      sub: SUB,
      email: 'a@b.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      relationships: [],
      roles: []
    })

    const [userCall] = callsFor(tx, users)
    expect(userCall.values).toMatchObject({
      userId: SUB,
      email: 'a@b.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1'
    })
    expect(userCall.conflict.target).toBe(users.userId)
    // The current org context is refreshed on every login.
    expect(userCall.conflict.set).toHaveProperty('currentRelationshipId')
    // `created` is never in the update set — it must keep its original value.
    expect(userCall.conflict.set).not.toHaveProperty('created')
  })

  test('records currentRelationshipId as null when the token omits it', async () => {
    const tx = makeTx()
    await persistSession(makeDrizzle(tx), { sub: SUB })
    const [userCall] = callsFor(tx, users)
    expect(userCall.values.currentRelationshipId).toBeNull()
  })

  test('targets the composite unique constraints for relationships and roles', async () => {
    const tx = makeTx()
    await persistSession(makeDrizzle(tx), {
      sub: SUB,
      relationships: ['rel-1:org-1:Acme Ltd:0:Employee:1'],
      roles: ['rel-1:bng completer:3']
    })

    const [relCall] = callsFor(tx, relationships)
    expect(relCall.conflict.target).toEqual([
      relationships.userId,
      relationships.relationshipId
    ])
    expect(relCall.values).toMatchObject({
      userId: SUB,
      relationshipId: 'rel-1',
      orgId: 'org-1',
      orgName: 'Acme Ltd'
    })

    const [roleCall] = callsFor(tx, roles)
    expect(roleCall.conflict.target).toEqual([
      roles.userId,
      roles.relationshipId,
      roles.name
    ])
    expect(roleCall.values).toMatchObject({
      userId: SUB,
      relationshipId: 'rel-1',
      name: 'bng completer',
      status: 3
    })
  })

  test('still upserts the user when there are no relationships or roles', async () => {
    const tx = makeTx()
    await persistSession(makeDrizzle(tx), { sub: SUB })
    expect(callsFor(tx, users)).toHaveLength(1)
    expect(callsFor(tx, relationships)).toHaveLength(0)
    expect(callsFor(tx, roles)).toHaveLength(0)
  })

  test('appends one login_audit row in the same transaction, de-duped on session_id', async () => {
    const tx = makeTx()
    await persistSession(makeDrizzle(tx), {
      sub: SUB,
      email: 'a@b.test',
      currentRelationshipId: 'rel-1',
      sessionId: 'sess-1'
    })

    const [auditCall] = callsFor(tx, loginAudit)
    expect(callsFor(tx, loginAudit)).toHaveLength(1)
    expect(auditCall.values).toMatchObject({
      userId: SUB,
      email: 'a@b.test',
      currentRelationshipId: 'rel-1',
      sessionId: 'sess-1'
    })
    // De-dup on session_id via DO NOTHING (never DO UPDATE — the append-only
    // guard rejects UPDATE).
    expect(auditCall.conflict).toEqual({ target: loginAudit.sessionId })
  })
})
