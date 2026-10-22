import { config } from '../../config.js'
import { ERROR_CODES } from './errors.js'
import { runFormatGate } from './format-gate.js'
import { buildServiceTemplateBuffer } from '../../../test/helpers/service-template-gpkg.js'
import { withTempGpkgFile } from '../../../test/helpers/gpkg.js'

/** Run the format gate over a BNG Service template file built from `options`. */
function gate(options) {
  return withTempGpkgFile(buildServiceTemplateBuffer(options), (filePath) =>
    runFormatGate(filePath)
  )
}

const codes = (result) => result.errors.map((error) => error.code)

describe('runFormatGate', () => {
  const flagAsSet = config.get('serviceTemplate.enabled')

  afterEach(() => {
    config.set('serviceTemplate.enabled', flagAsSet)
  })

  describe('with the service-template flag on', () => {
    beforeEach(() => {
      config.set('serviceTemplate.enabled', true)
    })

    test('refuses a valid BNG Service template file as not yet read, naming its template and version', async () => {
      const result = await gate()

      expect(result).toEqual({
        valid: false,
        errors: [
          {
            code: ERROR_CODES.SERVICE_TEMPLATE_NOT_YET_READ,
            message: expect.stringContaining('cannot read yet'),
            details: { template: { name: 'bng-service', version: '1.0' } }
          }
        ],
        template: { name: 'bng-service', version: '1.0' }
      })
    })

    test('passes on the gate’s own refusal of a file that fails it', async () => {
      const result = await gate({ records: [] })

      expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_MISSING])
    })
  })

  describe('with the service-template flag off', () => {
    test('checks the file against the legacy template', async () => {
      config.set('serviceTemplate.enabled', false)

      const result = await gate()

      expect(result.valid).toBe(false)
      expect(codes(result)).not.toContain(
        ERROR_CODES.SERVICE_TEMPLATE_NOT_YET_READ
      )
      expect(codes(result)).toContain(ERROR_CODES.GPKG_MISSING_LAYER)
    })
  })
})
