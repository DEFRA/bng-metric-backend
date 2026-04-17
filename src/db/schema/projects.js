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
  bngProjectVersion: integer('bng_project_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
})

export { projects }
