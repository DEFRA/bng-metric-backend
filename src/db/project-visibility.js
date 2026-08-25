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

// Resolve the relationship the user is currently acting in: the VERIFIED TOKEN
// first, falling back to what bng.users recorded at their last interactive
// sign-in.
//
// Preferring the token is what makes CONCURRENT SESSIONS work. bng.users holds
// one row per user, so its current_relationship_id records only the most recent
// sign-in anywhere. A user signed in on two devices under two different orgs is
// indistinguishable from the database alone — both requests would resolve to
// whichever org signed in last, silently serving one session the other's
// projects. The token is the only per-session carrier of that context, so it has
// to be the primary source (BMD-936).
//
// BMD-936 briefly made this DB-only, because a refreshed id_token appeared to
// return a DIFFERENT currentRelationshipId. That diagnosis was wrong: the drift
// classifier in the frontend proved the refreshed value is the SAME id in a
// DIFFERENT CASE (`differs:case-only`). GUIDs are case-insensitive (RFC 4122),
// so Defra ID is entitled to emit either; our verbatim comparison was the whole
// defect. Hence every relationship-id comparison here is lower()-folded, and the
// token is trusted again.
//
// The fallback still matters: a refresh_token grant can return the enrichment
// claims blank (BMD-829), and a token with no org context must not empty out a
// user's project list.
//
// lower() on the columns means the (user_id, relationship_id) index on bng.roles
// can only use its leading user_id column for this predicate. user_id is highly
// selective, so the residual scan is per-user and tiny; a functional index on
// lower(relationship_id) is the fix if that ever stops being true.
//
// The CREATE path must resolve the context identically, or a project can be
// stamped outside the scope it is read back through and disappear the moment it
// is made — see resolveCurrentOrgContext in src/db/org-context.js.
function currentRelationshipExpr(sub, relationshipId) {
  return sql`coalesce(lower(${relationshipId}::text), lower((select u.current_relationship_id
        from bng.users u where u.user_id = ${sub})))`
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
    sql`lower(${projects.relationshipId}) is not distinct from ${currentRelationshipExpr(sub, relationshipId)}`,
    or(
      isNull(projects.relationshipId),
      // Case-folded on both sides: bng.roles rows are written from whatever case
      // the sign-in token carried, and bng.projects.relationship_id from whatever
      // the stamping token carried — which need not be the same case for the
      // same relationship.
      sql`exists (select 1 from bng.roles r
            where r.user_id = ${sub}
              and lower(r.relationship_id) = lower(${projects.relationshipId})
              and r.status = ${ROLE_STATUS_APPROVED})`
    )
  )
}

export { visibleToUser }
