import {
  pgSchema,
  uuid,
  text,
  timestamp,
  index,
  unique
} from 'drizzle-orm/pg-core'

const bng = pgSchema('bng')

// Append-only audit trail: one row per successful user login. Written only
// through src/db/persist-login-audit.js as part of the POST /auth/session
// workflow (persist-session.js), from the verified Defra ID token claims.
// session_id plus current_relationship_id is UNIQUE. Inserts use ON CONFLICT
// DO NOTHING, so retries are a no-op while an organisation switch is recorded.
// The table is made
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
    sessionId: text('session_id'),
    loggedInAt: timestamp('logged_in_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('idx_login_audit_user_id').on(table.userId),
    unique('uq_login_audit_session_relationship').on(
      table.sessionId,
      table.currentRelationshipId
    )
  ]
)

export { loginAudit }
