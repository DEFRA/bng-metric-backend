import { STAGE_BASELINE } from 'bng-library/bng-service'
import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { lineageErrorsFor, withLineageErrors } from './lineage-stage.js'
import { templateReadSource } from './template-tables.js'
import {
  buildServiceTemplateBuffer,
  populatedBaselineRows
} from '../../../../test/helpers/service-template-gpkg.js'
import { withTempGpkgFile } from '../../../../test/helpers/gpkg.js'

const ERROR = { code: 'STAGED_UNKNOWN_PARENT_REF', message: 'missing parent' }
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000'

/** Post-intervention rows as the worker holds them, one naming no real parent. */
const postInterventionLayers = {
  areas: [
    {
      properties: {
        fid: 1,
        'Parcel Ref': 'H001',
        'Retention Category': 'Retained',
        parent_uuid: UNKNOWN_UUID
      }
    }
  ],
  layerTables: { areas: 'Area Habitats Post-Intervention' }
}

describe('lineageErrorsFor', () => {
  it('has nothing to check without a baseline stage', () => {
    expect(lineageErrorsFor('unused.gpkg', postInterventionLayers)).toEqual([])
  })

  it('checks the rows against the Baseline tables the lineage source names', async () => {
    const errors = await withTempGpkgFile(
      buildServiceTemplateBuffer({ rows: populatedBaselineRows() }),
      (filePath) =>
        lineageErrorsFor(
          filePath,
          postInterventionLayers,
          templateReadSource('1.0', STAGE_BASELINE)
        )
    )

    expect(errors.map((e) => e.code)).toEqual([
      ERROR_CODES.STAGED_UNKNOWN_PARENT_REF
    ])
  })
})

describe('withLineageErrors', () => {
  const accepted = { valid: true, errors: [], sizes: { areas: [] } }

  it('leaves the verdict alone when there are none', () => {
    expect(withLineageErrors(accepted, [])).toBe(accepted)
  })

  it('refuses the file, adding the errors after the stage’s own', () => {
    const refused = { valid: false, errors: [{ code: 'HABITAT_REF_MISSING' }] }

    expect(withLineageErrors(refused, [ERROR])).toEqual({
      valid: false,
      errors: [{ code: 'HABITAT_REF_MISSING' }, ERROR]
    })
    expect(withLineageErrors(accepted, [ERROR])).toEqual({
      ...accepted,
      valid: false,
      errors: [ERROR]
    })
  })
})
