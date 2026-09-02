import { describe, it, expect } from 'vitest'

import { validateGeoPackageLayers } from './index.js'

// Behaviour is covered by integration-tests/geometry-validate-baseline-layers.test.js
// (the rule-by-rule spec) and geometry-verdict-regression.test.js (the whole
// example-files corpus). This file just guards the API contract.

describe('validateGeoPackageLayers', () => {
  // The worker parses the GeoPackage itself rather than being handed a clone of
  // the layers, so the path is not optional — a caller without one has nothing
  // to validate with, and failing loudly beats silently skipping the geometry
  // checks.
  it('throws when no file path is supplied', async () => {
    await expect(
      validateGeoPackageLayers({ redline: [], areas: [] }, 'baseline')
    ).rejects.toThrow(/file path/)
  })
})
