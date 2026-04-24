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
const dbInfo = {
  method: 'GET',
  path: '/db-info',
  handler: async (request, _h) => {
    const result = await request.pg.query('SELECT version()')
    return { version: result.rows[0].version }
  }
}

export { dbInfo }
