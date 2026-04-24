/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: success
 */
const health = {
  method: 'GET',
  path: '/health',
  handler: (_request, h) => h.response({ message: 'success' })
}

export { health }
