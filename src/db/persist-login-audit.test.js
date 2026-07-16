import { describe, test, expect, vi } from 'vitest'

import { insertLoginAudit } from './persist-login-audit.js'
import { loginAudit } from './schema/index.js'

function makeDrizzle() {
  const values = vi.fn().mockResolvedValue(undefined)
  const insert = vi.fn().mockReturnValue({ values })
  return { drizzle: { insert }, insert, values }
}

describe('insertLoginAudit', () => {
  test('appends one row to loginAudit from the primary claim names', async () => {
    const { drizzle, insert, values } = makeDrizzle()
    const claims = {
      sub: 'user-1',
      email: 'user@bng.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      sessionId: 'sess-1'
    }

    await insertLoginAudit(drizzle, claims)

    expect(insert).toHaveBeenCalledWith(loginAudit)
    expect(values).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'user@bng.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      currentRelationshipId: 'rel-1',
      sessionId: 'sess-1'
    })
  })

  test('falls back to given_name / family_name / sid', async () => {
    const { drizzle, values } = makeDrizzle()
    const claims = {
      sub: 'user-2',
      given_name: 'Grace',
      family_name: 'Hopper',
      sid: 'sess-2'
    }

    await insertLoginAudit(drizzle, claims)

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
    const { drizzle, values } = makeDrizzle()

    await insertLoginAudit(drizzle, { sub: 'user-3' })

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
