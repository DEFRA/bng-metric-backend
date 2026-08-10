// Resolve the org context a project is CREATED under.
//
// This is the write-side twin of the read-side scope in project-visibility.js,
// and the two MUST resolve the same relationship or a project can be written
// outside the scope it is read back through — i.e. vanish the instant it is
// created. Both prefer the verified token's `currentRelationshipId` and fall
// back to what bng.users recorded at the user's last interactive sign-in.
//
// The fallback matters because Defra ID (Azure AD B2C) runs its
// relationship/role enrichment only on an interactive sign-in, so an id_token
// obtained through a refresh_token grant can come back with `relationships`,
// `roles` and `currentRelationshipId` BLANK — and the frontend forwards that
// token RAW (it merges the claims into its own session, but the backend never
// sees the merge). A project created during that window would otherwise be
// stamped with no org while the read path scoped to the stored one.
//
// Kept as a DB read rather than folded into the INSERT so the resolved context
// is an ordinary value the route can log, test and assert on.
import { and, eq } from 'drizzle-orm'

import { relationships, users } from './schema/index.js'
import { currentOrgContext } from '../services/defra-id/claims.js'

/**
 * Resolve `{ relationshipId, orgId }` for the org context the user is acting in.
 *
 * Returns both as null when the token carries no current relationship AND
 * bng.users has none for them (a first-ever request, or a user whose session
 * was never persisted) — which stamps an org-less project, read back through
 * the matching org-less scope.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} db
 * @param {object} claims the verified token payload
 * @returns {Promise<{relationshipId: string|null, orgId: string|null}>}
 */
async function resolveCurrentOrgContext(db, claims) {
  const fromToken = currentOrgContext(claims)
  if (fromToken.relationshipId) {
    return fromToken
  }

  // The org id rides along from bng.relationships, which was written from the
  // same verified token that set current_relationship_id. It stays null for
  // citizens (who have no organisation) and when the relationship row is
  // missing — org_id is descriptive; relationship_id is what scopes reads.
  const [row] = await db
    .select({
      relationshipId: users.currentRelationshipId,
      orgId: relationships.orgId
    })
    .from(users)
    .leftJoin(
      relationships,
      and(
        eq(relationships.userId, users.userId),
        eq(relationships.relationshipId, users.currentRelationshipId)
      )
    )
    .where(eq(users.userId, claims?.sub))
    .limit(1)

  return {
    relationshipId: row?.relationshipId ?? null,
    orgId: row?.orgId ?? null
  }
}

export { resolveCurrentOrgContext }
