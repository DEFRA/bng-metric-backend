/**
 * @openapi
 * /db-info:
 *   get:
 *     tags:
 *       - Database
 *     summary: Database version info
 *     responses:
 *       200:
 *         description: Returns the PostgreSQL version
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 */
// Local/dev diagnostic only — exposes the Postgres version. This is a
// DB-introspection endpoint and is never registered in production (see
// src/plugins/router.js). It opts out of the secure-by-default auth strategy so
// the diagnostic works without a token in the environments where it does run.
const dbInfo = {
  method: 'GET',
  path: '/db-info',
  options: { auth: false },
  handler: async (request, _h) => {
    const result = await request.pg.query('SELECT version()')
    return { version: result.rows[0].version }
  }
}

export { dbInfo }
