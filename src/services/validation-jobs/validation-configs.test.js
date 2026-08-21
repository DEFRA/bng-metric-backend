import { describe, it, expect } from 'vitest'

import { validationConfigFor } from './validation-configs.js'

describe('validationConfigFor', () => {
  it('resolves the baseline flow', () => {
    expect(validationConfigFor('baseline')).toMatchObject({
      projectDocumentKey: 'baseline',
      uploadLabel: 'baseline'
    })
  })

  it('resolves the post-intervention flow', () => {
    expect(validationConfigFor('postIntervention')).toMatchObject({
      projectDocumentKey: 'postIntervention',
      uploadLabel: 'post-intervention'
    })
  })

  it('throws for a document key the pipeline cannot serve', () => {
    // A job row carries only its documentKey, so a bad one must fail loudly
    // rather than validate against the wrong flow's schema.
    expect(() => validationConfigFor('nonsense')).toThrow(
      /Unsupported validation documentKey/
    )
  })
})
