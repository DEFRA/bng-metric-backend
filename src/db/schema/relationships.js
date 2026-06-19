import { pgSchema, text, timestamp, unique } from 'drizzle-orm/pg-core'

import { users } from './users.js'

const bng = pgSchema('bng')

// Org relationships carried in a user's Defra ID token. Upserted (never
// deleted) on each login. The named UNIQUE constraint matches the DB constraint
// in changelog/db.changelog-1.7.xml (changeSet 20) so drizzle-kit generate
// won't propose dropping it, and so onConflictDoUpdate has a real unique index
// on (user_id, relationship_id) to target.
const relationships = bng.table(
  'relationships',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    relationshipId: text('relationship_id').notNull(),
    orgId: text('org_id'),
    orgName: text('org_name'),
    relationship: text('relationship'),
    lastUpdated: timestamp('last_updated', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique('uq_relationships_user_rel').on(table.userId, table.relationshipId)
  ]
)

export { relationships }
