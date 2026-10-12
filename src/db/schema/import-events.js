import {
  pgSchema,
  uuid,
  text,
  jsonb,
  timestamp,
  index
} from 'drizzle-orm/pg-core'

import { projects } from './projects.js'

export const importEvents = pgSchema('bng').table(
  'import_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    uploadId: text('upload_id').notNull(),
    documentKey: text('document_key').notNull(),
    details: jsonb('details').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [index('idx_import_events_project_id').on(table.projectId)]
)
