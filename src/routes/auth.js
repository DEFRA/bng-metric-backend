import { persistSession } from '../db/persist-session.js'
import { insertLoginAudit } from '../db/persist-login-audit.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

/**
 * @openapi
 * /auth/session:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Persist the authenticated user's identity, relationships and roles
 *     description: |
 *       Called by the frontend after a successful login with the user's Defra ID
 *       id_token as a Bearer token. The backend verifies the token (defra-jwt
 *       strategy) and upserts bng.users / bng.relationships / bng.roles from the
 *       verified claims in one transaction. No request body — identity comes
 *       solely from the verified token.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Session persisted
 *       401:
 *         description: Missing or invalid bearer token
 */
const postAuthSession = {
  method: 'POST',
  path: '/auth/session',
  options: {
    auth: 'defra-jwt'
  },
  handler: async (request, h) => {
    await persistSession(request.drizzle, request.auth.credentials)
    return h.response().code(HTTP_STATUS.NO_CONTENT)
  }
}

/**
 * @openapi
 * /auth/login-audit:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Append an immutable login-audit record for the authenticated user
 *     description: |
 *       Called by the frontend after a successful login with the user's Defra ID
 *       id_token as a Bearer token. The backend verifies the token (defra-jwt
 *       strategy) and appends one row to the append-only bng.login_audit table
 *       from the verified claims (email, first/last name, currentRelationshipId,
 *       session id) with a server-set UTC timestamp. No request body — identity
 *       comes solely from the verified token. The table is immutable (INSERT
 *       only); rows can never be updated, deleted or truncated.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Login recorded
 *       401:
 *         description: Missing or invalid bearer token
 */
const postAuthLoginAudit = {
  method: 'POST',
  path: '/auth/login-audit',
  options: {
    auth: 'defra-jwt'
  },
  handler: async (request, h) => {
    await insertLoginAudit(request.drizzle, request.auth.credentials)
    return h.response().code(HTTP_STATUS.NO_CONTENT)
  }
}

export { postAuthSession, postAuthLoginAudit }
