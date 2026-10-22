import { config } from '../../config.js'
import { ERROR_CODES } from './errors.js'
import { runFormatGate } from './format-gate.js'
import { EXTRACT_VARIANT } from './properties.js'
import { buildServiceTemplateBuffer } from '../../../test/helpers/service-template-gpkg.js'
import { withTempGpkgFile } from '../../../test/helpers/gpkg.js'

/**
 * Run the format gate, for the given endpoint, over a BNG Service template file
 * built from `options`.
 */
function gate(documentKey, options) {
  return withTempGpkgFile(buildServiceTemplateBuffer(options), (filePath) =>
    runFormatGate(filePath, documentKey)
  )
}

const codes = (result) => result.errors.map((error) => error.code)

const TEMPLATE_1_0 = { name: 'bng-service', version: '1.0' }

describe('runFormatGate', () => {
  const flagAsSet = config.get('serviceTemplate.enabled')

  afterEach(() => {
    config.set('serviceTemplate.enabled', flagAsSet)
  })

  describe('with the service-template flag on', () => {
    beforeEach(() => {
      config.set('serviceTemplate.enabled', true)
    })

    test('passes a valid file to the baseline endpoint, to be read from its Baseline tables', async () => {
      const result = await gate(EXTRACT_VARIANT.BASELINE)

      expect(result).toEqual({
        valid: true,
        errors: [],
        template: TEMPLATE_1_0,
        readSource: { format: 'bng-service', version: '1.0', stage: 'baseline' }
      })
    })

    test('refuses a valid file at the baseline + post-intervention endpoint as not yet read, naming its template and version', async () => {
      const result = await gate(EXTRACT_VARIANT.POST_INTERVENTION)

      expect(result).toEqual({
        valid: false,
        errors: [
          {
            code: ERROR_CODES.SERVICE_TEMPLATE_NOT_YET_READ,
            message: expect.stringContaining('cannot read yet'),
            details: { template: TEMPLATE_1_0 }
          }
        ],
        template: TEMPLATE_1_0
      })
    })

    test.each([EXTRACT_VARIANT.BASELINE, EXTRACT_VARIANT.POST_INTERVENTION])(
      'passes on the gate’s own refusal of a file that fails it, at the %s endpoint',
      async (documentKey) => {
        const result = await gate(documentKey, { records: [] })

        expect(codes(result)).toEqual([ERROR_CODES.TEMPLATE_VERSION_MISSING])
        expect(result).not.toHaveProperty('readSource')
      }
    )
  })

  describe('with the service-template flag off', () => {
    test('checks the file against the legacy template, with no read source', async () => {
      config.set('serviceTemplate.enabled', false)

      const result = await gate(EXTRACT_VARIANT.BASELINE)

      expect(result.valid).toBe(false)
      expect(codes(result)).toContain(ERROR_CODES.GPKG_MISSING_LAYER)
      expect(result).not.toHaveProperty('readSource')
    })
  })
})
