import { describe, expect, it } from 'vitest'

import { validateLineageStage, withLineageVerdict } from './lineage-stage.js'

const ERROR = { code: 'STAGED_UNKNOWN_PARENT_REF', message: 'missing parent' }

describe('validateLineageStage', () => {
  it('has nothing to check without a baseline stage', () => {
    expect(validateLineageStage({ filePath: 'unused.gpkg' })).toBeNull()
  })
})

describe('withLineageVerdict', () => {
  const accepted = { valid: true, errors: [], sizes: { areas: [] } }

  it('leaves the verdict alone without a lineage check', () => {
    expect(withLineageVerdict(accepted, null)).toBe(accepted)
  })

  it('keeps an accepted verdict when the links are sound', () => {
    expect(withLineageVerdict(accepted, { valid: true, errors: [] })).toEqual(
      accepted
    )
  })

  it('refuses the file when a link is not, adding its errors after the stage’s own', () => {
    const refused = { valid: false, errors: [{ code: 'HABITAT_REF_MISSING' }] }

    expect(
      withLineageVerdict(refused, { valid: false, errors: [ERROR] })
    ).toEqual({
      valid: false,
      errors: [{ code: 'HABITAT_REF_MISSING' }, ERROR]
    })
    expect(
      withLineageVerdict(accepted, { valid: false, errors: [ERROR] })
    ).toEqual({
      ...accepted,
      valid: false,
      errors: [ERROR]
    })
  })
})
