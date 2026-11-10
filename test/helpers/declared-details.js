import { expect } from 'vitest'

import { ERROR_CODE_DETAILS } from '../../src/validation/geopackage/errors.js'

/** The keys a list error carries for the habitats it names. */
const LIST_KEYS = ['count', 'sample']

/**
 * Expect `error` to send in its details only the values and variants that
 * ERROR_CODE_DETAILS declares for its code, which the frontend's wording is
 * held to: a name it does not declare would be one the wording cannot use.
 *
 * @param {{ code: string, details?: object }} error
 */
export function expectDeclaredDetails(error) {
  const { values = [], variants = [] } = ERROR_CODE_DETAILS[error.code] ?? {}
  const { variants: sent = [], ...rest } = error.details ?? {}
  for (const key of Object.keys(rest)) {
    expect([...values, ...LIST_KEYS], `${error.code}: ${key}`).toContain(key)
  }
  for (const variant of sent) {
    expect(variants, `${error.code}: variant ${variant}`).toContain(variant)
  }
}
