import { describe, it, expect } from 'vitest'

import {
  RLB_LYR as RlbFromConstants,
  HABITATS_LYR as HabitatsFromConstants
} from './geopackage-constants.js'
import * as internals from './geopackage-internals.js'
import * as schemaCompare from './geopackage-internals-schema-compare.js'
import * as schemaCompareSrs from './geopackage-internals-schema-compare-srs.js'
import * as sqliteInternals from './geopackage-internals-sqlite.js'
import * as validateFeatures from './geopackage-internals-validate-features.js'

describe('geopackage-internals.js (barrel)', () => {
  it('re-exports layer keys from geopackage-constants', () => {
    expect(internals.RLB_LYR).toBe(RlbFromConstants)
    expect(internals.HABITATS_LYR).toBe(HabitatsFromConstants)
  })

  it('re-exports formatSrsIdForError from geopackage-internals-sqlite', () => {
    expect(internals.formatSrsIdForError).toBe(
      sqliteInternals.formatSrsIdForError
    )
    expect(typeof internals.formatSrsIdForError).toBe('function')
  })

  it('re-exports schema compare helpers from geopackage-internals-schema-compare', () => {
    expect(internals.compareGpkgContentsToLayerSchema).toBe(
      schemaCompare.compareGpkgContentsToLayerSchema
    )
    expect(internals.compareBaselineLayerSrs).toBe(
      schemaCompareSrs.compareBaselineLayerSrs
    )
    expect(internals.compareGeometryRegistrationRow).toBe(
      schemaCompare.compareGeometryRegistrationRow
    )
    expect(internals.compareDefinedColumnsToSchema).toBe(
      schemaCompare.compareDefinedColumnsToSchema
    )
    expect(internals.pragmaTableInfoByLowerName).toBe(
      schemaCompare.pragmaTableInfoByLowerName
    )
    expect(internals.compareOneLayerToBaselineSchema).toBe(
      schemaCompare.compareOneLayerToBaselineSchema
    )
    expect(internals.compareGpkgToBaselineSchema).toBe(
      schemaCompare.compareGpkgToBaselineSchema
    )
  })

  it('re-exports feature validators from geopackage-internals-validate-features', () => {
    expect(internals.validateRedLineBoundary).toBe(
      validateFeatures.validateRedLineBoundary
    )
    expect(internals.validateHabitats).toBe(validateFeatures.validateHabitats)
    expect(internals.validateHedgerows).toBe(validateFeatures.validateHedgerows)
    expect(internals.validateWatercourses).toBe(
      validateFeatures.validateWatercourses
    )
  })

  it('does not advertise unexpected exports', () => {
    const allowed = new Set([
      'RLB_LYR',
      'HABITATS_LYR',
      'compareBaselineLayerSrs',
      'compareDefinedColumnsToSchema',
      'compareGeometryRegistrationRow',
      'compareGpkgContentsToLayerSchema',
      'compareGpkgToBaselineSchema',
      'compareOneLayerToBaselineSchema',
      'formatSrsIdForError',
      'pragmaTableInfoByLowerName',
      'validateHabitats',
      'validateHedgerows',
      'validateRedLineBoundary',
      'validateWatercourses'
    ])
    expect(new Set(Object.keys(internals))).toEqual(allowed)
  })

  it('exposes callable formatSrsIdForError behaviour through the barrel', () => {
    expect(internals.formatSrsIdForError(null)).toBe('unset')
  })
})
