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

    expect(sql).toContain('"relationship_id" is not distinct from')
    expect(sql).toContain('u.current_relationship_id')
  })

  // BMD-936: the org context is read from bng.users, never from the token. A
  // refresh_token grant's id_token can carry a blank currentRelationshipId, or a
  // non-blank one naming a DIFFERENT relationship from the one the user chose at
  // sign-in — so binding the token's value made a user's visible project set
  // depend on which grant last issued their token.
  test.each([
    ['carries the current relationship', inOrg(REL_A)],
    ['carries a different relationship', inOrg(REL_B)],
    ['carries an empty relationship', claims({ currentRelationshipId: '' })],
    ['carries no enrichment claims at all', claims()]
  ])('ignores the token when it %s', (_name, credentials) => {
    const { sql, params } = renderSql(credentials)

    expect(sql).toContain('u.current_relationship_id')
    expect(sql).toContain('bng.users u')
    expect(params).not.toContain(REL_A)
    expect(params).not.toContain(REL_B)
  })

  test('resolves the same context regardless of what the token claims', () => {
    // The read scope must not shift under a user mid-session. Two tokens for the
    // same `sub` — one from sign-in, one from a refresh that defaulted the org —
    // must produce byte-identical SQL and bindings.
    const atSignIn = inOrg(REL_A)
    const afterRefresh = claims({
      currentRelationshipId: REL_B,
      relationships: [`${REL_B}:org-b:Globex:0:Employee:1`],
      roles: [`${REL_B}:bng completer:${ROLE_STATUS.COMPLETE_APPROVED}`]
    })

    expect(renderSql(afterRefresh)).toEqual(renderSql(atSignIn))
  })

  test('binds nothing from the token but the sub, plus the approved status', () => {
    // owner scope, org-context subquery, role EXISTS — all keyed on `sub`.
    const { params } = renderSql(inOrg(REL_A))

    expect(params).toEqual([SUB, SUB, SUB, ROLE_STATUS.COMPLETE_APPROVED])
  })
})
