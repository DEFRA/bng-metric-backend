import { config } from '../../config.js'
import { validateGpkgFile } from './geopackage.js'
import { validateServiceTemplateGpkgFile } from './service-template/service-template-gate.js'

/**
 * The format gate the service-template flag selects. With the flag on, only a
 * BNG Service template file in a supported version passes; with it off, only
 * a legacy file, exactly as before the flag. Nothing switches between the two
 * by looking at the file. Read per request, so a test can set the flag.
 *
 * @param {string} filePath
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string }> }}
 */
export function runFormatGate(filePath) {
  return config.get('serviceTemplate.enabled')
    ? validateServiceTemplateGpkgFile(filePath)
    : validateGpkgFile(filePath)
}
