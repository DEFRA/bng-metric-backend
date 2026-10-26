import { describe } from 'vitest'

import { config } from '../../src/config.js'

/**
 * Tests whose outcome depends on the service-template flag.
 *
 * CI runs the tests twice, once with SERVICE_TEMPLATE_ENABLED off and once with
 * it on, and both must pass. A test that uploads a legacy file only holds with
 * the flag off, and one that uploads a BNG Service template file only with it
 * on, so each runs in its own half and is skipped in the other. Everything else
 * runs in both.
 *
 * Read when the test file loads, which is when CI's environment is in force.
 */
const serviceTemplateEnabled = config.get('serviceTemplate.enabled')

const LEGACY_ONLY =
  'uploads a legacy file, which the service-template flag refuses'

/**
 * A suite for the legacy template, run with the flag off. A file whose every
 * suite uploads a legacy file imports it as `describe`.
 */
export const describeLegacy = describe.skipIf(serviceTemplateEnabled)

/** A suite for the BNG Service template, run with the flag on. */
export const describeServiceTemplate = describe.runIf(serviceTemplateEnabled)

/**
 * Skip one legacy test, in a suite that otherwise runs in both halves. Called
 * first thing in the test, with the test context's `skip`.
 *
 * @param {(condition: boolean, note?: string) => void} skip
 */
export function skipWithServiceTemplate(skip) {
  skip(serviceTemplateEnabled, LEGACY_ONLY)
}
