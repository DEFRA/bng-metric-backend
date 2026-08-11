import { createValidateGeoPackageRoute } from './validate-geopackage-route.js'

const POST_INTERVENTION_VALIDATION_CONFIG = Object.freeze({
  routeName: 'validatePostIntervention',
  path: '/post-intervention/validate/{uploadId}',
  projectDocumentKey: 'postIntervention',
  uploadLabel: 'post-intervention',
  validationFailedMessage: 'Unable to validate post-intervention file'
})

/**
 * @openapi
 * /post-intervention/validate/{uploadId}:
 *   post:
 *     tags:
 *       - Post Intervention
 *     summary: Validate a post-intervention GeoPackage upload
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId:
 *                 type: string
 *                 format: uuid
 *                 description: Saves the unpacked post-intervention data against the project's JSONB document.
 *     responses:
 *       200:
 *         description: Returns validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code: { type: string }
 *                       message: { type: string }
 *                       details:
 *                         type: object
 *       400:
 *         description: uploadId or projectId is missing or not a valid UUID
 *       404:
 *         description: projectId does not match an existing project
 *       409:
 *         description: Another post-intervention upload for the same project is currently being persisted - retry shortly
 *       413:
 *         description: File exceeds the maximum allowed size (100 MB)
 *       422:
 *         description: Upload was rejected by CDP Uploader
 *       500:
 *         description: Validation pipeline raised an unexpected error
 *       502:
 *         description: Upload status could not be verified, or S3 connection error
 *       504:
 *         description: Upload did not reach ready state in time, or S3 download timed out
 */
const validatePostIntervention = createValidateGeoPackageRoute(
  POST_INTERVENTION_VALIDATION_CONFIG
)

export { validatePostIntervention }
