import { createValidateGeoPackageAsyncRoute } from './validate-geopackage-async-route.js'

const BASELINE_ASYNC_CONFIG = Object.freeze({
  routeName: 'validateBaselineAsync',
  path: '/baseline/validate-async/{uploadId}',
  projectDocumentKey: 'baseline',
  statusPathPrefix: '/validation-jobs'
})

/**
 * @openapi
 * /baseline/validate-async/{uploadId}:
 *   post:
 *     tags:
 *       - Baseline
 *     summary: Enqueue a baseline GeoPackage upload for validation
 *     description: |
 *       Records the job and returns immediately; no validation happens on the
 *       request. Poll the returned `statusUrl` until `done` is true. Registered
 *       only when ASYNC_VALIDATION_ENABLED is set — the synchronous
 *       /baseline/validate/{uploadId} remains the default.
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
 *                 description: When provided, the unpacked baseline data is saved against the project once the job completes.
 *     responses:
 *       202:
 *         description: Job accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId: { type: string, format: uuid }
 *                 status: { type: string, example: pending }
 *                 statusUrl: { type: string, example: /validation-jobs/6f1e...
 *                 }
 *       400:
 *         description: uploadId is missing or not a valid UUID
 */
const validateBaselineAsync = createValidateGeoPackageAsyncRoute(
  BASELINE_ASYNC_CONFIG
)

export { validateBaselineAsync }
