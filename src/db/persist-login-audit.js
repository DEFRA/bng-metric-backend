// The single sanctioned path for writing the append-only bng.login_audit table.
// Called from persist-session.js (the POST /auth/session workflow) with the
// VERIFIED token payload (never the frontend's parsed claims), inside the same
// transaction as the user/relationship/role upserts.
//
// De-dup: session_id is UNIQUE and the insert uses ON CONFLICT DO NOTHING, so a
// repeat login for an already-recorded session is a graceful no-op — the table
// records distinct logins, not endpoint calls. DO NOTHING (never DO UPDATE)
// keeps this compatible with the append-only guard, which rejects UPDATE.
// The row is immutable once written (guard triggers in db.changelog-1.10.xml).
//
// PII safety: this module must NOT log `claims` or any token contents (email,
// names). Callers log at most the `sub`.
import { loginAudit } from './schema/index.js'

// Map the verified Defra ID token claims to login_audit columns, mirroring the
// claim names and fallbacks used by persist-session.js. logged_in_at is left to
// the database default (now(), UTC) so the timestamp is server-generated.
function loginAuditValues(claims) {
  return {
    userId: claims.sub,
    email: claims.email ?? null,
    firstName: claims.firstName ?? claims.given_name ?? null,
    lastName: claims.lastName ?? claims.family_name ?? null,
    currentRelationshipId: claims.currentRelationshipId ?? null,
    sessionId: claims.sessionId ?? claims.sid ?? null
  }
}

/**
 * Append one immutable login-audit row for the authenticated user, de-duplicated
 * on session_id (a repeat login for the same session is a graceful no-op).
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} db drizzle handle
 *   or a transaction (persist-session passes its tx)
 * @param {object} claims verified Defra ID token payload (must carry `sub`)
 * @returns {Promise<void>}
 */
async function insertLoginAudit(db, claims) {
  await db
    .insert(loginAudit)
    .values(loginAuditValues(claims))
    .onConflictDoNothing({ target: loginAudit.sessionId })
}

export { insertLoginAudit }
