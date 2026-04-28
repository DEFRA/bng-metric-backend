import {
  pgSchema,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index
} from 'drizzle-orm/pg-core'

const bng = pgSchema('bng')

const auditLog = bng.table(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    project: jsonb('project').notNull(),
    userId: text('user_id').notNull(),
    bngProjectVersion: integer('bng_project_version').notNull(),
    operation: text('operation').notNull(),
    auditedAt: timestamp('audited_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [index('idx_audit_log_project_id').on(table.projectId)]
)

export { auditLog }
