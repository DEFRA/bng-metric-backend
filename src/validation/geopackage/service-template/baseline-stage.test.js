import { beforeEach, describe, expect, test, vi } from 'vitest'

import { readGeoPackage } from '../geopackage.js'
import { validateGeoPackageLayers } from '../index.js'
import { EXTRACT_VARIANT } from '../properties.js'
import { FEATURE_READ_MODE } from '../read-feature-tables.js'
import { readBaselineStage, validateBaselineStage } from './baseline-stage.js'

vi.mock('../geopackage.js', () => ({ readGeoPackage: vi.fn() }))
vi.mock('../index.js', () => ({ validateGeoPackageLayers: vi.fn() }))

const FILE = '/tmp/upload.gpkg'
const BASELINE_SOURCE = {
  format: 'bng-service',
  version: '1.0',
  stage: 'baseline'
}

describe('the Baseline tables of a combined upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validateBaselineStage', () => {
    test('checks nothing when there is no baseline stage to check', async () => {
      const result = await validateBaselineStage({
        filePath: FILE,
        loadBaselineLayers: vi.fn(),
        projectId: 'p'
      })

      expect(result).toBeNull()
      expect(validateGeoPackageLayers).not.toHaveBeenCalled()
    })

    test('checks the Baseline tables as the baseline endpoint does', async () => {
      const verdict = { valid: true, errors: [], sizes: { areas: [] } }
      validateGeoPackageLayers.mockResolvedValue(verdict)
      const loadLayers = vi.fn()

      const result = await validateBaselineStage({
        filePath: FILE,
        baselineReadSource: BASELINE_SOURCE,
        loadBaselineLayers: loadLayers,
        projectId: 'p'
      })

      expect(result).toBe(verdict)
      expect(validateGeoPackageLayers).toHaveBeenCalledWith(
        loadLayers,
        EXTRACT_VARIANT.BASELINE,
        { filePath: FILE, includeSizes: true, source: BASELINE_SOURCE }
      )
    })
  })

  describe('readBaselineStage', () => {
    test('reads nothing when there is no baseline stage', () => {
      expect(readBaselineStage(FILE, undefined, null)).toBeUndefined()
      expect(readBaselineStage(FILE, BASELINE_SOURCE, null)).toBeUndefined()
      expect(readGeoPackage).not.toHaveBeenCalled()
    })

    test('reads the Baseline tables’ shapes, with the sizes their check measured', () => {
      const layers = { areas: [] }
      readGeoPackage.mockReturnValue(layers)
      const sizes = { areas: [{ areaSqm: 1 }] }

      expect(
        readBaselineStage(
          { filePath: FILE, baselineReadSource: BASELINE_SOURCE },
          { sizes }
        )
      ).toEqual({
        layers,
        geometrySizes: sizes
      })
      expect(readGeoPackage).toHaveBeenCalledWith(
        FILE,
        FEATURE_READ_MODE.serialised,
        BASELINE_SOURCE
      )
    })
  })
})
