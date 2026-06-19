import { describe, test, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { visibleToUser } from './project-visibility.js'
import { ROLE_STATUS } from '../services/defra-id/claims.js'

// Render the predicate to SQL so we can assert its shape without a database.
// The integration tests cover the runtime allow/deny behaviour against Postgres.
const dialect = new PgDialect()
const SUB = 'user-sub-001'

function renderSql() {
  const query = dialect.sqlToQuery(visibleToUser(SUB))
  return { sql: query.sql.toLowerCase(), params: query.params }
}

describe('visibleToUser', () => {
  test('scopes to the owner and ORs legacy-null with an approved-role EXISTS', () => {
    const { sql, params } = renderSql()

    expect(sql).toContain('"user_id" =')
    expect(sql).toContain('"relationship_id" is null')
    expect(sql).toContain('exists (select 1 from bng.roles r')
    expect(sql).toContain('r.status =')
    expect(params).toContain(SUB)
  })

  test('only the approved status (3) is bound into the role check', () => {
    const { params } = renderSql()
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
})
