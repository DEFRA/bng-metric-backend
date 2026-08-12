import { createValidateGeoPackageRoute } from './validate-geopackage-route.js'

const BASELINE_VALIDATION_CONFIG = Object.freeze({
  routeName: 'validateBaseline',
  path: '/baseline/validate/{uploadId}',
  projectDocumentKey: 'baseline',
  uploadLabel: 'baseline',
  validationFailedMessage: 'Unable to validate baseline file'
})

/**
 * @openapi
 * /baseline/validate/{uploadId}:
 *   post:
 *     tags:
 *       - Baseline
 *     summary: Validate a baseline GeoPackage upload
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
 *                 description: When provided, the unpacked baseline data is saved against the project's JSONB document.
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
 *                         description: |
 *                           Structured payload, present on list-bearing error
 *                           codes (e.g. AREA_PARCELS_OUTSIDE_REDLINE,
 *                           PARCEL_OVERLAPS, AREA_PARCELS_TOO_SMALL).
 *                           Always carries `count` (the truthful total of
 *                           offending features) and `sample` (a capped array
 *                           of per-feature objects with `idx`, `fid`, and
 *                           `feature_ref` — overlaps and slivers carry
 *                           variant shapes).
 *                         properties:
 *                           count: { type: integer }
 *                           sample:
 *                             type: array
 *                             items: { type: object }
 *       400:
 *         description: uploadId is missing or not a valid UUID
 *       404:
 *         description: projectId was provided but does not match an existing project
 *       409:
 *         description: Another baseline upload for the same project is currently being persisted — retry shortly
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
const validateBaseline = createValidateGeoPackageRoute(
  BASELINE_VALIDATION_CONFIG
)

export { validateBaseline }
