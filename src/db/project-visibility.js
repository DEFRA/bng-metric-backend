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
import { ROLE_STATUS_APPROVED } from '../services/defra-id/claims.js'

// Resolve the relationship the user is currently acting in, ALWAYS from the
// value bng.users recorded at their last interactive sign-in — never from the
// token in front of us (BMD-936).
//
// Defra ID (Azure AD B2C) runs its relationship/role enrichment only on an
// interactive sign-in, so the org context in an id_token obtained through a
// refresh_token grant is not authoritative. It can be blank, and it can also be
// non-blank but WRONG — a default relationship rather than the one the user
// actually chose. The frontend pins those claims in its own session, but it
// forwards the RAW refreshed token, so the backend sees whatever B2C put in it.
// Preferring that token meant a user's project list could empty out (blank
// context) or silently switch orgs (defaulted context) purely because a token
// happened to renew mid-session.
//
// bng.users.current_relationship_id has none of that ambiguity. It is written
// only by POST /auth/session from a verified token (src/db/persist-session.js),
// and the org context only ever changes at an interactive sign-in — which always
// re-posts the session — so the stored value is both authoritative and current.
// Reading it here keeps the predicate zero-trust (nothing is taken from the
// request beyond the verified `sub`) and synchronous, so it still drops straight
// into any `.where(...)`.
//
// The one behaviour this gives up: if POST /auth/session failed at sign-in, the
// row is absent and the user is scoped to their org-less projects rather than
// being rescued by the token. That is the correct trade — a failed session
// persist is a loud, logged, sign-in-time event (the frontend warns on it),
// whereas the token fallback silently produced a DIFFERENT scope for reads and
// writes depending on which grant issued the token.
//
// The CREATE path must resolve the context identically, or a project can be
// stamped outside the scope it is read back through and disappear the moment it
// is made — see resolveCurrentOrgContext in src/db/org-context.js.
function currentRelationshipExpr(sub) {
  return sql`(select u.current_relationship_id
        from bng.users u where u.user_id = ${sub})`
}

/**
 * Build the `where` condition that scopes a projects query to the rows visible
 * to the requesting user in their CURRENT org context. Combine with other
 * conditions via drizzle's `and(...)`.
 *
 * Takes the whole verified token payload rather than just the `sub`, so no call
 * site can scope by owner and forget the org. Only the `sub` is read from it —
 * the org context comes from bng.users, not the token (see
 * currentRelationshipExpr).
 *
 * @param {object} credentials the verified token payload (request.auth.credentials)
 */
function visibleToUser(credentials) {
  const sub = credentials?.sub

  return and(
    eq(projects.userId, sub),
    // `is not distinct from` so the null case matches too: a user with no org
    // context sees exactly their org-less projects, and nobody else's.
    sql`${projects.relationshipId} is not distinct from ${currentRelationshipExpr(sub)}`,
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
