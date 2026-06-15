import {
  pgSchema,
  text,
  smallint,
  timestamp,
  unique,
  index
} from 'drizzle-orm/pg-core'

import { users } from './users.js'

const bng = pgSchema('bng')

// Roles (with status) carried in a user's Defra ID token. Upserted (never
// deleted) on each login, keyed on (user_id, relationship_id, name) — removal
// of access arrives naturally as a status update (6/7), not a delete.
//
// The named UNIQUE constraint and the (user_id, relationship_id) index mirror
// changelog/db.changelog-1.7.xml (changeSet 21): the UNIQUE backs
// onConflictDoUpdate, the index backs the RBAC visibility EXISTS join in
// src/db/project-visibility.js.
const roles = bng.table(
  'roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    relationshipId: text('relationship_id').notNull(),
    name: text('name').notNull(),
    status: smallint('status').notNull(),
    lastUpdated: timestamp('last_updated', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique('uq_roles_user_rel_name').on(
      table.userId,
      table.relationshipId,
      table.name
    ),
    index('idx_roles_user_rel').on(table.userId, table.relationshipId)
  ]
)

export { roles }
