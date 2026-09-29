import { pgSchema, text } from 'drizzle-orm/pg-core'

export const localPlanningAuthorities = pgSchema('bng').table(
  'local_planning_authorities',
  {
    reference: text('reference').primaryKey(),
    name: text('name').notNull()
  }
)
