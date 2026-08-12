import { describe, it, expect } from 'vitest'
import { validateGeoPackageLayers } from './index.js'

// End-to-end behavior is covered by postgis/index.integration.test.js (which
// runs against a real Postgres). This file just guards the API contract.

describe('validateGeoPackageLayers', () => {
  it('throws when no pg pool is supplied', async () => {
    await expect(
      validateGeoPackageLayers({ redline: [], areas: [] })
    ).rejects.toThrow(/pg pool/)
  })
})
