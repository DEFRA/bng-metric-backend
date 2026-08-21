import { createValidateGeoPackageAsyncRoute } from './validate-geopackage-async-route.js'

const POST_INTERVENTION_ASYNC_CONFIG = Object.freeze({
  routeName: 'validatePostInterventionAsync',
  path: '/post-intervention/validate-async/{uploadId}',
  projectDocumentKey: 'postIntervention',
  statusPathPrefix: '/validation-jobs'
})

/**
 * @openapi
 * /post-intervention/validate-async/{uploadId}:
 *   post:
 *     tags:
 *       - Post-intervention
 *     summary: Enqueue a post-intervention GeoPackage upload for validation
 *     description: |
 *       Records the job and returns immediately; no validation happens on the
 *       request. Poll the returned `statusUrl` until `done` is true. Registered
 *       only when ASYNC_VALIDATION_ENABLED is set.
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       202:
 *         description: Job accepted
 *       400:
 *         description: uploadId is missing or not a valid UUID
 */
const validatePostInterventionAsync = createValidateGeoPackageAsyncRoute(
  POST_INTERVENTION_ASYNC_CONFIG
)

export { validatePostInterventionAsync }
