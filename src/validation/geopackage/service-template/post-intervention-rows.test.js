import { describe, expect, test } from 'vitest'

import { withTempGpkgFile } from '../../../../test/helpers/gpkg.js'
import {
  buildServiceTemplateBuffer,
  populatedBaselineRows,
  populatedPostInterventionRows
} from '../../../../test/helpers/service-template-gpkg.js'
import { hasPostInterventionFeatures } from './post-intervention-rows.js'

const VERSION = '1.0'

function hasFeatures(options) {
  return withTempGpkgFile(buildServiceTemplateBuffer(options), (filePath) =>
    hasPostInterventionFeatures(filePath, VERSION)
  )
}

describe('hasPostInterventionFeatures', () => {
  test('finds the features in the Post-Intervention tables', async () => {
    expect(await hasFeatures({ rows: populatedPostInterventionRows() })).toBe(
      true
    )
  })

  test('finds none when only the Baseline tables hold features', async () => {
    expect(await hasFeatures({ rows: populatedBaselineRows() })).toBe(false)
  })

  test('counts only the tables the file has, rather than failing on one it lacks', async () => {
    expect(
      await hasFeatures({
        omitTables: ['Individual Trees Post-Intervention'],
        rows: populatedBaselineRows()
      })
    ).toBe(false)
  })
})
