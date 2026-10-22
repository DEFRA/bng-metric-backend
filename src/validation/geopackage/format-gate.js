import { config } from '../../config.js'
import { ERROR_CODES, makeError } from './errors.js'
import { validateGpkgFile } from './geopackage.js'
import { validateServiceTemplateGpkgFile } from './service-template/service-template-gate.js'

const NOT_YET_READ_MESSAGE =
  'This file is in the BNG Service template, which the service cannot read yet. Upload it again once support for the template is available.'

/**
 * The service checks a BNG Service template file but cannot read its habitats
 * yet: the legacy reader that follows the gate would look for legacy tables and
 * find none. So a file that passes is refused here, plainly, rather than
 * failing confusingly later. The template reader replaces this.
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
 * Until the template reader lands, a file that passes the BNG Service template
 * gate is refused as not yet read.
 *
 * @param {string} filePath
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string, details?: object }> }}
 */
export function runFormatGate(filePath) {
  if (!config.get('serviceTemplate.enabled')) {
    return validateGpkgFile(filePath)
  }
  const result = validateServiceTemplateGpkgFile(filePath)
  return result.valid && result.template ? notYetRead(result.template) : result
}
