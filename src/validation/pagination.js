import Joi from 'joi'

import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../db/project-list.js'

// Shared limit/offset query keys for the project list endpoints (BMD-933).
// `limit` carries a default so an existing client that sends neither parameter
// is still bounded — that default is the whole point of the ticket.
const paginationKeys = {
  limit: Joi.number()
    .integer()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT),
  offset: Joi.number().integer().min(0).default(0)
}

export { paginationKeys }
