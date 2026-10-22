import { STAGE_BASELINE } from 'bng-library/bng-service'

import { config } from '../../config.js'
import { ERROR_CODES, makeError } from './errors.js'
import { validateGpkgFile } from './geopackage.js'
import { EXTRACT_VARIANT } from './properties.js'
import { validateServiceTemplateGpkgFile } from './service-template/service-template-gate.js'
import { templateReadSource } from './service-template/template-tables.js'

const NOT_YET_READ_MESSAGE =
  'This file is in the BNG Service template, which the service cannot read yet. Upload it again once support for the template is available.'

/**
 * The baseline + post-intervention endpoint cannot save a BNG Service template
 * file yet: it derives the baseline from the post-intervention rows, and this
 * template keeps its baseline in tables of its own. So a file that passes is
 * refused here, plainly, rather than failing confusingly later. Reading both
 * stages replaces this.
 *
 * @param {{ name: string, version: string }} template
 */
function notYetRead(template) {
  return {
    valid: false,
    errors: [
      makeError(
        ERROR_CODES.SERVICE_TEMPLATE_NOT_YET_READ,
        NOT_YET_READ_MESSAGE,
        {
          template
        }
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
 * tells the reads that follow which version and stage to read: the Baseline
 * tables, for the baseline endpoint. The baseline + post-intervention endpoint
 * refuses it as not yet read.
 *
 * @param {string} filePath
 * @param {string} documentKey the route's project document key, one of
 *   EXTRACT_VARIANT
 * @returns {{
 *   valid: boolean,
 *   errors: Array<{ code: string, message: string, details?: object }>,
 *   readSource?: import('./service-template/template-tables.js').TemplateReadSource
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
  if (documentKey !== EXTRACT_VARIANT.BASELINE) {
    return notYetRead(result.template)
  }
  return {
    ...result,
    readSource: templateReadSource(result.template.version, STAGE_BASELINE)
  }
}
