// The single sanctioned path for writing the append-only bng.login_audit table.
// Called from POST /auth/login-audit with the VERIFIED token payload (never the
// frontend's parsed claims). One INSERT per successful login; the row is
// immutable thereafter (guard triggers in changelog/db.changelog-1.10.xml).
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
 * Append one immutable login-audit row for the authenticated user.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {object} claims verified Defra ID token payload (must carry `sub`)
 * @returns {Promise<void>}
 */
async function insertLoginAudit(drizzle, claims) {
  await drizzle.insert(loginAudit).values(loginAuditValues(claims))
}

export { insertLoginAudit }
