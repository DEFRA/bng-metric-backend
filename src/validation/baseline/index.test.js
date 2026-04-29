import { describe, it, expect } from 'vitest'
import { validateBaselineLayers } from './index.js'

// End-to-end behavior is covered by postgis/index.integration.test.js (which
// runs against a real Postgres). This file just guards the API contract.

describe('validateBaselineLayers', () => {
  it('throws when no pg pool is supplied', async () => {
    await expect(
      validateBaselineLayers({ redline: [], areas: [] })
    ).rejects.toThrow(/pg pool/)
  })
})
