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
  // BMD-936 (revised): the write side prefers the VERIFIED TOKEN, exactly as the
  // read side does, so the two always agree. The token is the only per-session
  // carrier of org context — resolving from bng.users alone cannot tell two
  // concurrent sessions apart, and would stamp a project with whichever org
  // signed in most recently on any device.
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

  test('stamps each concurrent session under its own org', async () => {
    const stored = [{ relationshipId: 'rel-stored', orgId: 'org-stored' }]

    const deviceA = await resolveCurrentOrgContext(
      mockDb(stored),
      tokenWith('rel-a', 'rel-a:org-a:Acme Ltd:0:Employee:1')
    )
    const deviceB = await resolveCurrentOrgContext(
      mockDb(stored),
      tokenWith('rel-b', 'rel-b:org-b:Globex:0:Employee:1')
    )

    expect(deviceA.relationshipId).toBe('rel-a')
    expect(deviceB.relationshipId).toBe('rel-b')
  })

  // Defra ID returns the same GUID in a different case on a refresh grant. The
  // org id must still resolve, and the stamped value is canonicalised so the
  // database holds one spelling per relationship.
  test('matches the relationship case-insensitively and stamps canonically', async () => {
    const db = mockDb([])

    const result = await resolveCurrentOrgContext(
      db,
      tokenWith('REL-TOKEN', 'rel-token:org-token:Acme Ltd:0:Employee:1')
    )

    expect(result).toEqual({
      relationshipId: 'rel-token',
      orgId: 'org-token'
    })
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
