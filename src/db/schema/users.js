import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core'

const bng = pgSchema('bng')

// One row per authenticated Defra ID user (user_id is the token `sub`).
// Written only through src/db/persist-session.js, which upserts this row plus
// the user's relationships and roles inside a single transaction on each login.
// current_relationship_id is the org context the user is currently acting in
// (the token's currentRelationshipId, matching one of their bng.relationships
// rows). Nullable and refreshed on each login.
const users = bng.table('users', {
  userId: text('user_id').primaryKey(),
  email: text('email'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  created: timestamp('created', { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp('last_login', { withTimezone: true }),
  sessionId: text('session_id'),
  currentRelationshipId: text('current_relationship_id')
})

export { users }
