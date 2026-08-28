// Resolve the org context a project is CREATED under.
//
// This is the write-side twin of the read-side scope in project-visibility.js,
// and the two MUST resolve the same relationship or a project can be written
// outside the scope it is read back through — i.e. vanish the instant it is
// created. Both prefer the verified token's `currentRelationshipId` and fall
// back to what bng.users recorded at the user's last interactive sign-in.
//
// Preferring the token is what lets one user hold SEVERAL concurrent sessions in
// different orgs: bng.users has one row per user, so the stored context only
// remembers the most recent sign-in anywhere, and a second device signing in as
// another org would otherwise silently move the first device's project scope.
// The token is the only per-session carrier of that context (BMD-936).
//
// The fallback still matters: a refresh_token grant can return the enrichment
// claims blank (BMD-829), and a project created in that window must not be
// stamped org-less while the read path scopes to the stored relationship.
//
// Relationship ids are compared case-insensitively throughout — Defra ID returns
// the same GUID in a different case on a refresh grant, and GUIDs are
// case-insensitive by definition (see canonicalRelationshipId).
//
// Kept as a DB read rather than folded into the INSERT so the resolved context
// is an ordinary value the route can log, test and assert on.
import { and, eq, sql } from 'drizzle-orm'

import { relationships, users } from './schema/index.js'
import { currentOrgContext } from '../services/defra-id/claims.js'

/**
 * The org id recorded for one of the user's relationships. Matched on the
 * canonical (lower-cased) id, since rows written from different tokens need not
 * agree on case.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} db
 * @param {string|undefined} userId
 * @param {string} canonicalRelationship already lower-cased by currentOrgContext
 * @returns {Promise<string|null>}
 */
async function lookupOrgId(db, userId, canonicalRelationship) {
  const [row] = await db
    .select({ orgId: relationships.orgId })
    .from(relationships)
    .where(
      and(
        eq(relationships.userId, userId),
        sql`lower(${relationships.relationshipId}) = ${canonicalRelationship}`
      )
    )
    .limit(1)
  return row?.orgId ?? null
}

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
    if (fromToken.orgId) {
      return fromToken
    }
    // The token named a relationship but carried no matching `relationships`
    // entry to resolve the org from — the narrow BMD-829 shape where enrichment
    // comes back partially blank. Look the org up rather than stamping null:
    // projects.org_id is written once at creation and never recomputed, so a
    // null here is permanent.
    //
    // The relationship id itself is still taken from the token. Falling back to
    // the stored context for it would reintroduce the multi-session bug this
    // change exists to fix — bng.users remembers only the most recent sign-in on
    // any device, so a second session's org would silently capture this one.
    return {
      relationshipId: fromToken.relationshipId,
      orgId: await lookupOrgId(db, claims?.sub, fromToken.relationshipId)
    }
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
        sql`lower(${relationships.relationshipId}) = lower(${users.currentRelationshipId})`
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
