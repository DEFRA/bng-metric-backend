import {
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION
} from 'bng-library/bng-service'

import { config } from '../../config.js'
import { ERROR_CODES, makeError } from './errors.js'
import { validateGpkgFile } from './geopackage.js'
import { EXTRACT_VARIANT } from './properties.js'
import { hasPostInterventionFeatures } from './service-template/post-intervention-rows.js'
import { validateServiceTemplateGpkgFile } from './service-template/service-template-gate.js'
import { templateReadSource } from './service-template/template-tables.js'

const POST_INTERVENTION_EMPTY_MESSAGE =
  'The Post-Intervention tables in this file are all empty, so it has no post-intervention habitats to upload. Upload it as a baseline, or add the post-intervention habitats and upload it again.'

/**
 * A combined upload must describe a post-intervention stage. A file whose
 * Post-Intervention tables are all empty is a baseline, and saving it here
 * would replace the stored post-intervention document with an empty one.
 *
 * @param {{ name: string, version: string }} template
 */
function postInterventionEmpty(template) {
  return {
    valid: false,
    errors: [
      makeError(
        ERROR_CODES.POST_INTERVENTION_TABLES_EMPTY,
        POST_INTERVENTION_EMPTY_MESSAGE,
        { template }
      )
    ],
    template
  }
}

/**
 * The format gate the service-template flag selects. With the flag on, only a
 * BNG Service template file in a supported version passes; with it off, only
 * a legacy file, exactly as before the flag. Nothing switches between the two
 * by looking at the file. Read per request, so a test can set the flag.
 *
 * A BNG Service template file that passes comes back with `readSource`, which
 * tells the reads that follow which version and stage to read:
 *
 * - at the baseline endpoint, the Baseline tables;
 * - at the baseline + post-intervention endpoint, the Post-Intervention
 *   tables, with `baselineReadSource` naming the Baseline tables, which hold
 *   the baseline the same upload saves. That endpoint refuses a file whose
 *   Post-Intervention tables are all empty.
 *
 * @param {string} filePath
 * @param {string} documentKey the route's project document key, one of
 *   EXTRACT_VARIANT
 * @returns {{
 *   valid: boolean,
 *   errors: Array<{ code: string, message: string, details?: object }>,
 *   template?: { name: string, version: string } | null,
 *   readSource?: import('./service-template/template-tables.js').TemplateReadSource,
 *   baselineReadSource?: import('./service-template/template-tables.js').TemplateReadSource
 * }}
 */
export function runFormatGate(filePath, documentKey) {
  if (!config.get('serviceTemplate.enabled')) {
    return validateGpkgFile(filePath)
  }
  const result = validateServiceTemplateGpkgFile(filePath)
  if (!result.valid || !result.template) {
    return result
  }
  const { version } = result.template
  if (documentKey === EXTRACT_VARIANT.BASELINE) {
    return {
      ...result,
      readSource: templateReadSource(version, STAGE_BASELINE)
    }
  }
  if (!hasPostInterventionFeatures(filePath, version)) {
    return postInterventionEmpty(result.template)
  }
  return {
    ...result,
    readSource: templateReadSource(version, STAGE_POST_INTERVENTION),
    baselineReadSource: templateReadSource(version, STAGE_BASELINE)
  }
}
