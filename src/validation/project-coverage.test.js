// Coverage / drift guard for the data dictionary.
//
// The Joi schema in project.js is the *intended* shape of the project JSONB
// blob, and the data dictionary (npm run data-dictionary) is generated from it.
// But the persist paths validate with { allowUnknown: true } (baseline) or with
// no Joi validation at all (the habitat-edit PUT writes the document straight to
// the DB). So nothing at runtime stops the code from persisting a field the
// schema — and therefore the dictionary — does not declare.
//
// This test closes that gap. It drives the real document-construction code on a
// fixture and asserts every key it produces is declared in the schema. If a new
// field starts being persisted without being added to project.js, this fails,
// pointing at the exact undeclared path so the schema (and the dictionary) can
// be updated.
import { describe, expect, it } from 'vitest'

import {
  habitatDataSchema,
  habitatSchema,
  linearHabitatSchema,
  projectSchema
} from './project.js'
import { schemaPaths, undeclaredPaths } from './data-dictionary-paths.js'
import { extractHabitatData } from './baseline/extract-habitat-data.js'
import {
  recomputeAreaHabitat,
  recomputeHedgerow
} from './baseline/unit-calculation.js'
import { enrichBaselineDocumentWithUnits } from '../utilities/baseline/enrich-baseline-units.js'
import { STUB_EXTRACTED } from '../routes/baseline.test-fixtures.js'

const BNG_SRID = 27700
const ONE_HECTARE_SQM = 10_000
const HEDGE_METRES = 100
const WATER_METRES = 50

const FEATURE_ID_RED = '11111111-1111-1111-1111-111111111111'
const FEATURE_ID_HAB = '22222222-2222-2222-2222-222222222222'
const FEATURE_ID_HEDGE = '33333333-3333-3333-3333-333333333333'
const FEATURE_ID_WATER = '44444444-4444-4444-4444-444444444444'
const UPLOAD_ID = '55555555-5555-5555-5555-555555555555'

// Build a baseline document the way production does — parsed GeoPackage layers
// through extractHabitatData + the unit enrichment — so the produced keys are the
// real ones, not a hand-written guess. The type/condition values are chosen to
// resolve in bng-metric-engine so every feature type actually enriches (and
// therefore exercises the derived unit fields, including the watercourse
// encroachment multipliers).
function buildBaselineDocument() {
  const layers = {
    redline: [
      {
        featureId: FEATURE_ID_RED,
        properties: { 'Some GeoPackage Column': 'value' },
        nativeGeometry: {},
        nativeSrid: BNG_SRID
      }
    ],
    areas: [
      {
        featureId: FEATURE_ID_HAB,
        properties: {
          'Parcel Ref': 'P1',
          'Baseline Broad Habitat Type': 'Grassland',
          'Baseline Habitat Type': 'Lowland meadows',
          'Baseline Condition': 'Good',
          'Baseline Strategic Significance':
            'Area/compensation not in local strategy',
          'Retention Category': 'Retained'
        },
        nativeGeometry: {},
        nativeSrid: BNG_SRID
      }
    ],
    hedgerows: [
      {
        featureId: FEATURE_ID_HEDGE,
        properties: {
          'Parcel Ref': 'H1',
          'Baseline Hedge Type': 'Native hedgerow',
          'Baseline Condition': 'Good'
        },
        nativeGeometry: {},
        nativeSrid: BNG_SRID
      }
    ],
    watercourses: [
      {
        featureId: FEATURE_ID_WATER,
        properties: {
          'Parcel Ref': 'W1',
          'Baseline River Type': 'Ditches',
          'Baseline Condition': 'Good',
          'Baseline Encroachment into Watercourse': 'No Encroachment',
          'Baseline Encroachment into riparian zone':
            'No Encroachment/No Encroachment'
        },
        nativeGeometry: {},
        nativeSrid: BNG_SRID
      }
    ]
  }

  const meta = {
    uploadId: UPLOAD_ID,
    filename: 'baseline.gpkg',
    fileSize: 1024,
    importedAt: '2026-01-01T00:00:00.000Z',
    habitatSizes: {
      areaHabitats: {
        individualSquareMetres: [
          { featureId: FEATURE_ID_HAB, sizeSquareMetres: ONE_HECTARE_SQM }
        ],
        totalSquareMetres: ONE_HECTARE_SQM
      },
      hedgerows: {
        individualMetres: [
          { featureId: FEATURE_ID_HEDGE, sizeMetres: HEDGE_METRES }
        ],
        totalMetres: HEDGE_METRES
      },
      watercourses: {
        individualMetres: [
          { featureId: FEATURE_ID_WATER, sizeMetres: WATER_METRES }
        ],
        totalMetres: WATER_METRES
      }
    }
  }

  const { document } = extractHabitatData(layers, meta)
  enrichBaselineDocumentWithUnits(document)
  return document
}

function assertDerivedKeysDeclared(derived, schema, label) {
  const declaredKeys = new Set(Object.keys(schema.describe().keys))
  for (const key of Object.keys(derived)) {
    expect(
      declaredKeys.has(key),
      `${label} field "${key}" is not declared in the schema — add it (with a .description) so the data dictionary stays complete`
    ).toBe(true)
  }
}

describe('project JSONB data-dictionary coverage', () => {
  it('the baseline upload path persists only schema-declared fields', () => {
    const document = buildBaselineDocument()

    // Sanity: every feature type actually enriched, so the derived unit fields
    // are present in this fixture (not silently skipped).
    expect(document.habitats[0]).toHaveProperty('units')
    expect(document.hedgerows[0]).toHaveProperty('units')
    expect(document.watercourses[0]).toHaveProperty(
      'waterEncroachmentMultiplier'
    )

    // Every key the construction code produced is declared in habitatDataSchema.
    expect(undeclaredPaths(document, habitatDataSchema)).toEqual([])

    // Belt and braces: strict Joi validation (no allowUnknown) also rejects any
    // undeclared key, and confirms the produced values satisfy their types.
    const { error } = habitatDataSchema.validate(document)
    expect(error).toBeUndefined()
  })

  it('the post-intervention upload path (Proposed columns) persists only schema-declared fields', () => {
    // Same shape as the baseline build, but the engine-relevant values live in
    // the Proposed* columns and extraction runs with variant: postIntervention.
    const layers = {
      redline: [
        {
          featureId: FEATURE_ID_RED,
          properties: { 'Site Name': 'Site', Area: 5000 },
          nativeGeometry: {},
          nativeSrid: BNG_SRID
        }
      ],
      areas: [
        {
          featureId: FEATURE_ID_HAB,
          properties: {
            'Parcel Ref': 'P1',
            'Proposed Broad Habitat Type': 'Grassland',
            'Proposed Habitat Type': 'Lowland meadows',
            'Proposed Condition': 'Good',
            'Proposed Strategic Significance': 'High',
            'Proposed Distinctiveness': 'High',
            'Retention Category': 'Created'
          },
          nativeGeometry: {},
          nativeSrid: BNG_SRID
        }
      ],
      hedgerows: [
        {
          featureId: FEATURE_ID_HEDGE,
          properties: {
            'Parcel Ref': 'H1',
            'Proposed Hedge Type': 'Native hedgerow',
            'Proposed Condition': 'Good'
          },
          nativeGeometry: {},
          nativeSrid: BNG_SRID
        }
      ],
      watercourses: [
        {
          featureId: FEATURE_ID_WATER,
          properties: {
            'Parcel Ref': 'W1',
            'Proposed River Type': 'Ditches',
            'Proposed Condition': 'Good',
            'Proposed Encroachment into Watercourse': 'No Encroachment',
            'Proposed Encroachment into riparian zone':
              'No Encroachment/No Encroachment'
          },
          nativeGeometry: {},
          nativeSrid: BNG_SRID
        }
      ]
    }

    const meta = {
      uploadId: UPLOAD_ID,
      filename: 'post-intervention.gpkg',
      fileSize: 1024,
      importedAt: '2026-01-01T00:00:00.000Z',
      variant: 'postIntervention',
      habitatSizes: {
        areaHabitats: {
          individualSquareMetres: [
            { featureId: FEATURE_ID_HAB, sizeSquareMetres: ONE_HECTARE_SQM }
          ],
          totalSquareMetres: ONE_HECTARE_SQM
        },
        hedgerows: {
          individualMetres: [
            { featureId: FEATURE_ID_HEDGE, sizeMetres: HEDGE_METRES }
          ],
          totalMetres: HEDGE_METRES
        },
        watercourses: {
          individualMetres: [
            { featureId: FEATURE_ID_WATER, sizeMetres: WATER_METRES }
          ],
          totalMetres: WATER_METRES
        }
      }
    }

    const { document } = extractHabitatData(layers, meta)
    enrichBaselineDocumentWithUnits(document)

    // Proposed values landed in the named fields (not the Baseline* columns).
    expect(document.habitats[0]).toEqual(
      expect.objectContaining({
        type: 'Lowland meadows',
        strategicSignificance: 'High',
        rawDistinctiveness: 'High'
      })
    )

    expect(undeclaredPaths(document, habitatDataSchema)).toEqual([])
    const { error } = habitatDataSchema.validate(document)
    expect(error).toBeUndefined()
  })

  it('the feature-edit paths persist only schema-declared fields', () => {
    // recompute* are the source of the derived fields applyFeatureUpdate merges
    // onto a feature and writes back. Both the complete and soft-fail branches
    // are checked for area habitats and hedgerows.
    const habitatBranches = [
      recomputeAreaHabitat({
        broadType: 'Grassland',
        habitatType: 'Lowland meadows',
        condition: 'Good',
        sizeSquareMetres: ONE_HECTARE_SQM
      }),
      recomputeAreaHabitat({
        broadType: null,
        habitatType: null,
        condition: null,
        sizeSquareMetres: null
      })
    ]
    for (const derived of habitatBranches) {
      assertDerivedKeysDeclared(derived, habitatSchema, 'recomputeAreaHabitat')
    }

    const hedgerowBranches = [
      recomputeHedgerow({
        habitatType: 'Native hedgerow',
        condition: 'Good',
        sizeMetres: HEDGE_METRES
      }),
      recomputeHedgerow({
        habitatType: null,
        condition: null,
        sizeMetres: null
      })
    ]
    for (const derived of hedgerowBranches) {
      assertDerivedKeysDeclared(
        derived,
        linearHabitatSchema,
        'recomputeHedgerow'
      )
    }
  })

  it('the canonical extracted-baseline fixture matches the schema', () => {
    expect(undeclaredPaths(STUB_EXTRACTED.document, habitatDataSchema)).toEqual(
      []
    )
  })

  it('projectSchema describes a documentable tree (sanity)', () => {
    const declared = new Set()
    const openPaths = new Set()
    schemaPaths(projectSchema.describe(), '', declared, openPaths)
    expect(declared.has('baseline.habitats[].status')).toBe(true)
    expect(openPaths.has('baseline.habitats[].properties')).toBe(true)
  })
})
