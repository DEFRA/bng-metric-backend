import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema/index.js'

function createDrizzle(pool) {
  return drizzle(pool, { schema })
}

export { createDrizzle }
