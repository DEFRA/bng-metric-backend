import { describe, test, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { visibleToUser } from './project-visibility.js'
import { ROLE_STATUS } from '../services/defra-id/claims.js'

// Render the predicate to SQL so we can assert its shape without a database.
// The integration tests cover the runtime allow/deny behaviour against Postgres.
const dialect = new PgDialect()
const SUB = 'user-sub-001'
const REL_A = 'rel-org-a'
const REL_B = 'rel-org-b'

const claims = (extra = {}) => ({ sub: SUB, ...extra })

const inOrg = (relationshipId) =>
  claims({
    currentRelationshipId: relationshipId,
    relationships: [`${relationshipId}:org-1:Acme Ltd:0:Employee:1`],
    roles: [`${relationshipId}:bng completer:${ROLE_STATUS.COMPLETE_APPROVED}`]
  })

function renderSql(credentials) {
  const query = dialect.sqlToQuery(visibleToUser(credentials))
  return { sql: query.sql.toLowerCase(), params: query.params }
}

describe('visibleToUser', () => {
  test('scopes to the owner and ORs legacy-null with an approved-role EXISTS', () => {
    const { sql, params } = renderSql(inOrg(REL_A))

    expect(sql).toContain('"user_id" =')
    expect(sql).toContain('"relationship_id" is null')
    expect(sql).toContain('exists (select 1 from bng.roles r')
    expect(sql).toContain('r.status =')
    expect(params).toContain(SUB)
  })

  test('only the approved status (3) is bound into the role check', () => {
    const { params } = renderSql(inOrg(REL_A))
    expect(params).toContain(ROLE_STATUS.COMPLETE_APPROVED)
    // None of the denying statuses are baked into the predicate.
    for (const status of [
      ROLE_STATUS.PENDING,
      ROLE_STATUS.PENDING_VERIFICATION,
      ROLE_STATUS.COMPLETE_REJECTED,
      ROLE_STATUS.PENDING_APPEAL,
      ROLE_STATUS.REMOVED,
      ROLE_STATUS.LOCKED
    ]) {
      expect(params).not.toContain(status)
    }
  })

  // BMD-890: the org scope is the part that keeps a multi-org user's projects
  // apart. Without it, an approved role in EITHER org satisfied the EXISTS and
  // both orgs' projects came back.
  test('scopes the row to the relationship the user is currently acting in', () => {
    const { sql } = renderSql(inOrg(REL_A))

    expect(sql).toContain('is not distinct from')
    expect(sql).toContain('u.current_relationship_id')
  })

  // BMD-936 (revised): the org context comes from the VERIFIED TOKEN first,
  // falling back to bng.users. The token is the only per-session carrier of that
  // context, so a DB-only scope cannot tell two concurrent sessions apart — a
  // user signed in on two devices under two orgs would have both served
  // whichever org signed in last.
  test('binds the relationship the token carries', () => {
    const { sql, params } = renderSql(inOrg(REL_A))

    expect(sql).toContain('"relationship_id"')
    expect(sql).toContain('u.current_relationship_id')
    expect(params).toContain(REL_A)
    expect(params).not.toContain(REL_B)
  })

  test('scopes two concurrent sessions to their own org', () => {
    // The multi-session case this predicate exists to serve: same `sub`, two
    // live tokens, different orgs — the SQL must differ between them.
    const deviceA = renderSql(inOrg(REL_A))
    const deviceB = renderSql(inOrg(REL_B))

    expect(deviceA.params).toContain(REL_A)
    expect(deviceB.params).toContain(REL_B)
    expect(deviceA.params).not.toEqual(deviceB.params)
  })

  test.each([
    ['an empty relationship', claims({ currentRelationshipId: '' })],
    ['no enrichment claims at all', claims()]
  ])(
    'falls back to the stored context when the token carries %s',
    (_name, credentials) => {
      // A refresh_token grant can return the enrichment claims blank (BMD-829);
      // that must not empty out the user's project list.
      const { sql, params } = renderSql(credentials)

      expect(sql).toContain('u.current_relationship_id')
      expect(params).not.toContain(REL_A)
      expect(params).not.toContain(REL_B)
    }
  )

  // Defra ID returns the same GUID in a different case on a refresh grant, and
  // rows written from different tokens can disagree on case too — so every
  // relationship-id comparison folds case.
  test('compares every relationship id case-insensitively', () => {
    const { sql } = renderSql(inOrg(REL_A))

    expect(sql).toContain('lower("bng"."projects"."relationship_id")')
    expect(sql).toContain('lower(r.relationship_id)')
    expect(sql).toContain('lower((select u.current_relationship_id')
  })

  test('binds the sub, the token relationship and the approved status only', () => {
    // owner scope, the token's org context, the stored-context fallback and the
    // role EXISTS — nothing else reaches the query.
    const { params } = renderSql(inOrg(REL_A))

    expect(params).toEqual([
      SUB,
      REL_A,
      SUB,
      SUB,
      ROLE_STATUS.COMPLETE_APPROVED
    ])
  })
})
