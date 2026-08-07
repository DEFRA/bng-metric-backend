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
  test('takes the context from the verified token when it carries one', async () => {
    const db = mockDb([{ relationshipId: 'rel-stored', orgId: 'org-stored' }])

    const result = await resolveCurrentOrgContext(
      db,
      tokenWith('rel-token', 'rel-token:org-token:Acme Ltd:0:Employee:1')
    )

    expect(result).toEqual({
      relationshipId: 'rel-token',
      orgId: 'org-token'
    })
    // No DB round-trip on the common path.
    expect(db.select).not.toHaveBeenCalled()
  })

  // A refresh_token-grant id_token can arrive with the enrichment claims blank.
  // Falling back keeps the stamped context equal to the one reads scope by.
  test('falls back to the stored context when the token has none', async () => {
    const db = mockDb([{ relationshipId: 'rel-stored', orgId: 'org-stored' }])

    const result = await resolveCurrentOrgContext(db, tokenWith(''))

    expect(result).toEqual({
      relationshipId: 'rel-stored',
      orgId: 'org-stored'
    })
    expect(db.select).toHaveBeenCalledOnce()
  })

  test('falls back when the claim is missing entirely', async () => {
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
