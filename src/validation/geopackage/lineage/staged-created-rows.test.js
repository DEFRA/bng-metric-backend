// Brand-new habitats at post-intervention only, through the WHOLE staged
// chain without a database: validate (lineage + reconciliation over a fake
// PostGIS pool) → featureId assignment → staged-to-legacy transform → extract
// (both stages) → unit enrichment → the Joi schemas persistStagedUpload's
// caller gates on. The fixture carries two such rows: hedgerow HR-NEW-1 and
// tree T-NEW-1, both Created, parentless, with complete Proposed fields.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { enrichBaselineDocumentWithUnits } from '../../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { enrichPostInterventionDocumentWithUnits } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import { extractHabitatData } from '../baseline/extract-habitat-data.js'
import { extractPostIntervention } from '../post-intervention/extract-post-intervention.js'
import { ERROR_CODES } from '../errors.js'
import { habitatDataSchema, postInterventionDataSchema } from '../../project.js'
import { enrichOptionsForPostIntervention } from '../../../services/upload/save-upload-for-project.js'
import { extendBaselineLengthsForEnhancedChildren } from '../../../services/upload/save-staged-upload-for-project.js'
import { assignStagedFeatureIds } from './staged-feature-ids.js'
import {
  fakeStagedPool,
  planarLength
} from './staged-fake-pool.test-fixtures.js'
import { stagedToLegacyLayers } from './staged-to-legacy.js'
import { validateStagedGeoPackage } from './validate-staged-geopackage.js'

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'integration-tests',
  'fixtures',
  'staged-baseline-and-pi.gpkg'
)

const FAKE_PARCEL_AREA_SQ_M = 10_000

/**
 * Stand-in for calculateHabitatSizes so the pipeline runs without PostGIS.
 * Linear sizes are real planar lengths off the features' own geometry, so
 * the Created hedgerow's units come from its actual drawn length.
 */
function fakeHabitatSizes(layers) {
  const areaEntry = (feature) => ({
    featureId: feature.featureId,
    sizeSquareMetres: FAKE_PARCEL_AREA_SQ_M
  })
  const linearEntry = (feature) => ({
    featureId: feature.featureId,
    sizeMetres: planarLength(feature.nativeGeometry)
  })
  const totalOf = (entries, key) =>
    entries.reduce((sum, entry) => sum + entry[key], 0)
  const areaHabitats = layers.areas.map(areaEntry)
  const hedgerows = layers.hedgerows.map(linearEntry)
  const watercourses = layers.watercourses.map(linearEntry)
  return {
    areaHabitats: {
      individualSquareMetres: areaHabitats,
      totalSquareMetres: totalOf(areaHabitats, 'sizeSquareMetres')
    },
    hedgerows: {
      individualMetres: hedgerows,
      totalMetres: totalOf(hedgerows, 'sizeMetres')
    },
    watercourses: {
      individualMetres: watercourses,
      totalMetres: totalOf(watercourses, 'sizeMetres')
    }
  }
}

async function runChain() {
  const pool = fakeStagedPool()
  const validation = await validateStagedGeoPackage(FIXTURE, pool)

  const stagedWithIds = assignStagedFeatureIds(validation.staged)
  const { baseline, postIntervention } = stagedToLegacyLayers(stagedWithIds)

  const baselineExtract = extractHabitatData(baseline, {
    variant: 'baseline',
    habitatSizes: fakeHabitatSizes(baseline)
  })
  enrichBaselineDocumentWithUnits(baselineExtract.document)

  const enrichOptions = enrichOptionsForPostIntervention(
    baselineExtract.document
  )
  const extendedLengths = extendBaselineLengthsForEnhancedChildren(
    enrichOptions.baselineLengthByRef,
    stagedWithIds.postIntervention
  )

  const piExtract = extractPostIntervention(postIntervention, {
    habitatSizes: fakeHabitatSizes(postIntervention)
  })
  enrichPostInterventionDocumentWithUnits(
    piExtract.document,
    undefined,
    enrichOptions
  )
  return { validation, baselineExtract, piExtract, extendedLengths }
}

describe('Created parentless rows through the full staged chain (no DB)', () => {
  it('validates clean: the new hedge and tree trip no error and no lineage warning', async () => {
    const { validation } = await runChain()

    expect(validation.errors).toEqual([])
    expect(validation.valid).toBe(true)
    // The only warning is the fixture's two deliberate removals (HR-1's
    // grubbed-out half, felled tree T-2) — nothing about the Created rows.
    expect(validation.warnings.map((warning) => warning.code)).toEqual([
      ERROR_CODES.STAGED_FEATURES_REMOVED
    ])
    expect(validation.removed.map((entry) => entry.parent_ref).sort()).toEqual([
      'HR-1',
      'T-2'
    ])
  })

  it('enriches the Created hedgerow to Complete with units, without any baseline lookup', async () => {
    const { piExtract, extendedLengths } = await runChain()

    // Created linear rows must never resolve an Enhanced baseline length.
    expect(extendedLengths).toEqual([])

    const planted = piExtract.document.hedgerows.find(
      (hedgerow) => hedgerow.ref === 'HR-NEW-1'
    )
    expect(planted).toMatchObject({
      retentionCategory: 'Created',
      status: 'Complete'
    })
    expect(planted.sizeMetres).toBeCloseTo(150, 6)
    expect(planted.units).toBeGreaterThan(0)
  })

  it('enriches the Created tree to Complete with units', async () => {
    const { piExtract } = await runChain()

    const planted = piExtract.document.trees.find(
      (tree) => tree.ref === 'T-NEW-1'
    )
    expect(planted).toMatchObject({
      retentionCategory: 'Created',
      status: 'Complete'
    })
    expect(planted.units).toBeGreaterThan(0)
  })

  it('passes the schema gates persistStagedUpload is fed through', async () => {
    const { baselineExtract, piExtract } = await runChain()

    const baselineResult = habitatDataSchema.validate(
      baselineExtract.document,
      { allowUnknown: true }
    )
    expect(baselineResult.error).toBeUndefined()

    const piResult = postInterventionDataSchema.validate(piExtract.document, {
      allowUnknown: true
    })
    expect(piResult.error).toBeUndefined()
  })
})
