// Reusable RBAC visibility predicate for bng.projects, applied at query time on
// every project-by-id read/write endpoint.
//
// A project is visible to the requesting user (`sub`) when they own it AND
// either:
//   - it is a legacy row with no relationship (owner-fallback, no backfill), or
//   - their LATEST persisted role for the project's relationship is approved
//     (status 3). Because relationship_id is user-specific, the EXISTS subquery
//     is already scoped to this user's own relationship.
//
// Every other role status (1,2,4,5,6,7) denies — removed access surfaces as a
// status 6/7 row, which fails the `= 3` test.
import { and, eq, isNull, or, sql } from 'drizzle-orm'

import { projects } from './schema/index.js'
import { ROLE_STATUS_APPROVED } from '../services/defra-id/claims.js'

/**
 * Build the `where` condition that scopes a projects query to the rows visible
 * to `sub`. Combine with other conditions via drizzle's `and(...)`.
 *
 * @param {string} sub the requesting user's verified token subject
 */
function visibleToUser(sub) {
  return and(
    eq(projects.userId, sub),
    or(
      isNull(projects.relationshipId),
      sql`exists (select 1 from bng.roles r
            where r.user_id = ${sub}
              and r.relationship_id = ${projects.relationshipId}
              and r.status = ${ROLE_STATUS_APPROVED})`
    )
  )
}

export { visibleToUser }
