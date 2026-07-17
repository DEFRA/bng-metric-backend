import { persistSession } from '../db/persist-session.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

/**
 * @openapi
 * /auth/session:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Persist the authenticated user's session and record the login
 *     description: |
 *       Called by the frontend after a successful login with the user's Defra ID
 *       id_token as a Bearer token. The backend verifies the token (defra-jwt
 *       strategy) and, in one transaction, upserts bng.users / bng.relationships
 *       / bng.roles and appends an immutable bng.login_audit row from the
 *       verified claims. No request body — identity comes solely from the
 *       verified token. The login_audit append is de-duplicated on session_id,
 *       so a repeat call for an already-recorded session is a graceful no-op
 *       (still 204) rather than a duplicate audit row.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Session persisted and login recorded
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

export { postAuthSession }
