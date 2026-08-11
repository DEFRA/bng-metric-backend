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
    const { sql, params } = renderSql(inOrg(REL_A))

    expect(sql).toContain('"relationship_id" is not distinct from')
    expect(params).toContain(REL_A)
  })

  test('binds the CURRENT relationship, not another the user is approved for', () => {
    const bothOrgs = claims({
      currentRelationshipId: REL_A,
      relationships: [
        `${REL_A}:org-a:Acme Ltd:0:Employee:1`,
        `${REL_B}:org-b:Globex:0:Employee:1`
      ],
      roles: [
        `${REL_A}:bng completer:${ROLE_STATUS.COMPLETE_APPROVED}`,
        `${REL_B}:bng completer:${ROLE_STATUS.COMPLETE_APPROVED}`
      ]
    })

    const { params } = renderSql(bothOrgs)

    expect(params).toContain(REL_A)
    expect(params).not.toContain(REL_B)
  })

  test('falls back to the persisted current relationship when the token has none', () => {
    // A refreshed id_token can come back with the enrichment claims blanked, so
    // the org context is resolved from bng.users instead of being dropped.
    const { sql, params } = renderSql(claims())

    expect(sql).toContain('u.current_relationship_id')
    expect(sql).toContain('bng.users u')
    expect(params).toContain(null)
  })

  test('treats an empty currentRelationshipId as absent', () => {
    const { params } = renderSql(claims({ currentRelationshipId: '' }))
    expect(params).not.toContain('')
    expect(params).toContain(null)
  })
})
