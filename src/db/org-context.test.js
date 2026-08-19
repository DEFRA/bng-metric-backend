import { describe, test, expect, vi } from 'vitest'

import { resolveCurrentOrgContext } from './org-context.js'

const SUB = 'user-sub-001'

// Mirrors the select().from().leftJoin().where().limit() chain the resolver uses.
function mockDb(rows = []) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ limit })
  const leftJoin = vi.fn().mockReturnValue({ where })
  const from = vi.fn().mockReturnValue({ leftJoin })
  return { select: vi.fn().mockReturnValue({ from }), _limit: limit }
}

const tokenWith = (relationshipId, entry) => ({
  sub: SUB,
  currentRelationshipId: relationshipId,
  relationships: entry ? [entry] : []
})

describe('resolveCurrentOrgContext', () => {
  // BMD-936: the write side resolves the org context from bng.users, exactly as
  // the read side does — a token's `currentRelationshipId` is not authoritative
  // (a refresh_token grant can blank it, or default it to another relationship),
  // and a project stamped from the token would be read back through the stored
  // scope and vanish.
  test('takes the context from bng.users even when the token carries one', async () => {
    const db = mockDb([{ relationshipId: 'rel-stored', orgId: 'org-stored' }])

    const result = await resolveCurrentOrgContext(
      db,
      tokenWith('rel-token', 'rel-token:org-token:Acme Ltd:0:Employee:1')
    )

    expect(result).toEqual({
      relationshipId: 'rel-stored',
      orgId: 'org-stored'
    })
    expect(db.select).toHaveBeenCalledOnce()
  })

  test('resolves the same context whatever the token claims', async () => {
    const stored = [{ relationshipId: 'rel-stored', orgId: 'org-stored' }]

    const fromSignIn = await resolveCurrentOrgContext(
      mockDb(stored),
      tokenWith('rel-stored', 'rel-stored:org-stored:Acme Ltd:0:Employee:1')
    )
    const afterRefresh = await resolveCurrentOrgContext(
      mockDb(stored),
      tokenWith('rel-other', 'rel-other:org-other:Globex:0:Employee:1')
    )

    expect(afterRefresh).toEqual(fromSignIn)
  })

  test('reads the stored context when the claim is missing entirely', async () => {
    const db = mockDb([{ relationshipId: 'rel-stored', orgId: 'org-stored' }])

    const result = await resolveCurrentOrgContext(db, { sub: SUB })

    expect(result.relationshipId).toBe('rel-stored')
  })

  test('returns nulls when the user has no persisted session either', async () => {
    const db = mockDb([])

    const result = await resolveCurrentOrgContext(db, tokenWith(''))

    expect(result).toEqual({ relationshipId: null, orgId: null })
  })

  test('keeps a null org id for a citizen with no organisation', async () => {
    // Citizens hold a relationship but no org, so org_id is legitimately null.
    const db = mockDb([{ relationshipId: 'rel-citizen', orgId: null }])

    const result = await resolveCurrentOrgContext(db, tokenWith(''))

    expect(result).toEqual({ relationshipId: 'rel-citizen', orgId: null })
  })
})
