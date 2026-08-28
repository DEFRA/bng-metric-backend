import { describe, test, expect, vi } from 'vitest'

import { resolveCurrentOrgContext } from './org-context.js'

const SUB = 'user-sub-001'

// Mirrors the select().from().leftJoin().where().limit() chain the resolver uses.
// Covers both chains the resolver uses: the fallback's
// select().from().leftJoin().where().limit() and the org-id lookup's
// select().from().where().limit().
function mockDb(rows = []) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ limit })
  const leftJoin = vi.fn().mockReturnValue({ where })
  const from = vi.fn().mockReturnValue({ leftJoin, where })
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

  // Raised in review on #284: currentOrgContext returns orgId null when the
  // token names a relationship its `relationships` claim does not describe, and
  // projects.org_id is written once at creation and never recomputed — so a null
  // stamped here is permanent.
  describe('when the token names a relationship it does not describe', () => {
    const partiallyBlank = {
      sub: SUB,
      currentRelationshipId: 'rel-token',
      relationships: []
    }

    test('resolves the org id from bng.relationships instead of stamping null', async () => {
      const db = mockDb([{ orgId: 'org-looked-up' }])

      const result = await resolveCurrentOrgContext(db, partiallyBlank)

      expect(result).toEqual({
        relationshipId: 'rel-token',
        orgId: 'org-looked-up'
      })
    })

    test('keeps the relationship id from the TOKEN, not the stored context', async () => {
      // The reviewer's alternative — treating an unmatched id as "no token
      // context" — would fall back to bng.users here, which remembers only the
      // most recent sign-in on any device. That is exactly the multi-session
      // capture this change exists to prevent, so only the org id falls back.
      const db = mockDb([{ orgId: null, relationshipId: 'rel-other-device' }])

      const result = await resolveCurrentOrgContext(db, partiallyBlank)

      expect(result.relationshipId).toBe('rel-token')
    })

    test('still yields a null org id when the relationship is unknown to us', async () => {
      const db = mockDb([])

      const result = await resolveCurrentOrgContext(db, partiallyBlank)

      expect(result).toEqual({ relationshipId: 'rel-token', orgId: null })
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
