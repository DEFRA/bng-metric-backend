import {
  pgSchema,
  uuid,
  text,
  integer,
  jsonb,
  timestamp
} from 'drizzle-orm/pg-core'

const bng = pgSchema('bng')

const projects = bng.table('projects', {
  id: uuid('id').primaryKey(),
  project: jsonb('project').notNull(),
  userId: text('user_id').notNull(),
  // Authenticated actor responsible for the most recent project mutation.
  // Kept separate from userId, which remains the owning user's identity.
  lastModifiedBy: text('last_modified_by').notNull(),
  // Org context stamped at creation from the creator's current Defra ID
  // relationship, and the column every read is scoped by: a project is only
  // visible while its creator is signed in under THIS relationship. Nullable:
  // legacy rows have no relationship and are visible to their creator only when
  // they have no current org context — see src/db/project-visibility.js.
  orgId: text('org_id'),
  relationshipId: text('relationship_id'),
  bngProjectVersion: integer('bng_project_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
})

export { projects }
