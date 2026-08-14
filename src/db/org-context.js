// Resolve the org context a project is CREATED under.
//
// This is the write-side twin of the read-side scope in project-visibility.js,
// and the two MUST resolve the same relationship or a project can be written
// outside the scope it is read back through — i.e. vanish the instant it is
// created. Both read it from bng.users, recorded at the user's last interactive
// sign-in, and NEITHER reads it from the token (BMD-936).
//
// Defra ID (Azure AD B2C) runs its relationship/role enrichment only on an
// interactive sign-in, so the org context in an id_token from a refresh_token
// grant is not authoritative — it can come back blank, or non-blank but naming a
// different relationship from the one the user chose. The frontend pins those
// claims in its own session but forwards the token RAW, so the backend sees the
// raw values either way. Preferring them meant the org a project was stamped
// with could depend on which grant happened to issue the token.
//
// Kept as a DB read rather than folded into the INSERT so the resolved context
// is an ordinary value the route can log, test and assert on.
import { and, eq } from 'drizzle-orm'

import { relationships, users } from './schema/index.js'

/**
 * Resolve `{ relationshipId, orgId }` for the org context the user is acting in,
 * from the session bng.users persisted at their last interactive sign-in.
 *
 * Returns both as null when bng.users has no context for them (a first-ever
 * request, or a user whose session was never persisted) — which stamps an
 * org-less project, read back through the matching org-less scope.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} db
 * @param {object} claims the verified token payload — only `sub` is read
 * @returns {Promise<{relationshipId: string|null, orgId: string|null}>}
 */
async function resolveCurrentOrgContext(db, claims) {
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
