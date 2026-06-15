import { persistSession } from '../db/persist-session.js'

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
    return h.response().code(204)
  }
}

export { postAuthSession }
