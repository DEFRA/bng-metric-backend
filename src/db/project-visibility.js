// Reusable RBAC + org-scoping visibility predicate for bng.projects, applied at
// query time on every project-by-id read/write endpoint.
//
// A project is visible to the requesting user when ALL of the following hold:
//   1. they own it (user_id = the verified token `sub`), AND
//   2. it belongs to the org context they are acting in RIGHT NOW — its
//      relationship_id matches their current relationship (BMD-890), AND
//   3. either it is a legacy row with no relationship (owner-fallback, no
//      backfill), or their LATEST persisted role for that relationship is
//      approved (status 3).
//
// (2) is what keeps a multi-org user's projects apart. A user can hold an
// approved "bng completer" role in several orgs at once; without the org scope,
// a project created under org A stayed visible after switching to org B, because
// the role EXISTS check passed for BOTH relationships. Scoping to the CURRENT
// relationship — not merely "any relationship the user is approved for" — is
// what makes the boundary strict.
//
// Every other role status (1,2,4,5,6,7) denies — removed access surfaces as a
// status 6/7 row, which fails the `= 3` test.
import { and, eq, isNull, or, sql } from 'drizzle-orm'

import { projects } from './schema/index.js'
import {
  currentOrgContext,
  ROLE_STATUS_APPROVED
} from '../services/defra-id/claims.js'

// Resolve the relationship the user is currently acting in, preferring the
// verified token and falling back to the value bng.users recorded at their last
// sign-in.
//
// The fallback is not belt-and-braces: Defra ID (Azure AD B2C) runs its
// relationship/role enrichment only on an interactive sign-in, so an id_token
// obtained through a refresh_token grant can come back with `relationships`,
// `roles` and `currentRelationshipId` BLANK. The frontend re-merges those claims
// into its session (see bng-metric-frontend refresh-session.js) but forwards the
// RAW refreshed token, so the backend can legitimately see a token with no org
// context for a user who very much has one. Without the fallback that user's
// project list would silently empty out after a silent refresh.
//
// bng.users.current_relationship_id is written only by POST /auth/session from a
// verified token (src/db/persist-session.js), and the org context only ever
// changes at an interactive sign-in — which always re-posts the session — so the
// stored value stays in step. Reading it here keeps the predicate zero-trust
// (nothing is taken from the request beyond the verified token) and synchronous,
// so it still drops straight into any `.where(...)`.
function currentRelationshipExpr(sub, relationshipId) {
  return sql`coalesce(${relationshipId}::text, (select u.current_relationship_id
        from bng.users u where u.user_id = ${sub}))`
}

/**
 * Build the `where` condition that scopes a projects query to the rows visible
 * to the requesting user in their CURRENT org context. Combine with other
 * conditions via drizzle's `and(...)`.
 *
 * Takes the whole verified token payload rather than just the `sub`, so no call
 * site can scope by owner and forget the org.
 *
 * @param {object} credentials the verified token payload (request.auth.credentials)
 */
function visibleToUser(credentials) {
  const sub = credentials?.sub
  const { relationshipId } = currentOrgContext(credentials)

  return and(
    eq(projects.userId, sub),
    // `is not distinct from` so the null case matches too: a user with no org
    // context sees exactly their org-less projects, and nobody else's.
    sql`${projects.relationshipId} is not distinct from ${currentRelationshipExpr(sub, relationshipId)}`,
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
