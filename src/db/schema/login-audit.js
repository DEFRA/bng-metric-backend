import { pgSchema, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'

const bng = pgSchema('bng')

// Append-only audit trail: one row per successful user login. Written only
// through src/db/persist-login-audit.js as part of the POST /auth/session
// workflow (persist-session.js), from the verified Defra ID token claims.
// session_id is UNIQUE and inserts use ON CONFLICT DO NOTHING, so a repeat
// /auth/session for an already-recorded session is a graceful no-op — the
// table records distinct logins, not endpoint calls. The table is made
// immutable at the database level by guard triggers + REVOKE in
// changelog/db.changelog-1.10.xml (UPDATE/DELETE/TRUNCATE rejected; INSERT
// permitted). logged_in_at is server-set and stored in UTC.
const loginAudit = bng.table(
  'login_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    email: text('email'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    currentRelationshipId: text('current_relationship_id'),
    sessionId: text('session_id').unique('uq_login_audit_session_id'),
    loggedInAt: timestamp('logged_in_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [index('idx_login_audit_user_id').on(table.userId)]
)

export { loginAudit }
