import { beforeEach, describe, expect, test, vi } from 'vitest'

import { readGeoPackage } from '../geopackage.js'
import { validateGeoPackageLayers } from '../index.js'
import { EXTRACT_VARIANT } from '../properties.js'
import { FEATURE_READ_MODE } from '../read-feature-tables.js'
import {
  mergeStageVerdicts,
  readBaselineStage,
  validateBaselineStage
} from './baseline-stage.js'

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
        includeSizes: true
      })

      expect(result).toBeNull()
      expect(validateGeoPackageLayers).not.toHaveBeenCalled()
    })

    test('checks the Baseline tables as the baseline endpoint does, and counts their features', async () => {
      const layers = { areas: [{}, {}], hedgerows: [{}], missingLayers: [] }
      const verdict = { valid: true, errors: [], sizes: { areas: [] } }
      validateGeoPackageLayers.mockImplementation(async (load) => {
        load()
        return verdict
      })

      const result = await validateBaselineStage({
        filePath: FILE,
        baselineReadSource: BASELINE_SOURCE,
        loadBaselineLayers: () => layers,
        includeSizes: true
      })

      expect(result).toEqual({ ...verdict, featureCount: 3 })
      expect(validateGeoPackageLayers).toHaveBeenCalledWith(
        expect.any(Function),
        EXTRACT_VARIANT.BASELINE,
        {
          filePath: FILE,
          includeSizes: true,
          source: BASELINE_SOURCE,
          inThread: false
        }
      )
    })

    test('checks them on this thread when asked to', async () => {
      validateGeoPackageLayers.mockResolvedValue({ valid: true, errors: [] })

      await validateBaselineStage({
        filePath: FILE,
        baselineReadSource: BASELINE_SOURCE,
        loadBaselineLayers: () => ({}),
        includeSizes: true,
        inThread: true
      })

      expect(validateGeoPackageLayers).toHaveBeenCalledWith(
        expect.any(Function),
        EXTRACT_VARIANT.BASELINE,
        expect.objectContaining({ inThread: true })
      )
    })
  })

  describe('mergeStageVerdicts', () => {
    const error = (code) => ({ code, message: code })

    test('passes the endpoint’s own verdict on unchanged without a baseline stage', () => {
      const result = { valid: false, errors: [error('A')], sizes: {} }

      expect(mergeStageVerdicts(null, result)).toBe(result)
    })

    test('reports both stages’ errors, each naming its stage', () => {
      const merged = mergeStageVerdicts(
        { valid: false, errors: [error('A')] },
        { valid: false, errors: [error('B')] }
      )

      expect(merged).toEqual({
        valid: false,
        errors: [
          { ...error('A'), stage: 'baseline' },
          { ...error('B'), stage: 'post-intervention' }
        ]
      })
    })

    test.each([
      [true, true, true],
      [false, true, false],
      [true, false, false]
    ])(
      'is valid only when both stages are (baseline %s, post-intervention %s)',
      (baselineValid, piValid, valid) => {
        expect(
          mergeStageVerdicts(
            { valid: baselineValid, errors: [] },
            { valid: piValid, errors: [] }
          ).valid
        ).toBe(valid)
      }
    )
  })

  describe('readBaselineStage', () => {
    test('reads nothing without a baseline stage to read', () => {
      expect(
        readBaselineStage({ filePath: FILE }, { sizes: {} })
      ).toBeUndefined()
      expect(readGeoPackage).not.toHaveBeenCalled()
    })

    test('reads nothing when the Baseline tables were not checked', () => {
      expect(
        readBaselineStage(
          { filePath: FILE, baselineReadSource: BASELINE_SOURCE },
          null
        )
      ).toBeUndefined()
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
