// Vertical area habitats through the staged pipeline, end to end without a
// database: real fixture → transform → extract (both stages) → unit
// enrichment, with HAND-COMPUTED expected numbers. VAHs are area habitats in
// the metric but are drawn as LINESTRINGs, so their unit-bearing size is the
// hand-entered face `Area` (m²) column — the one thing the legacy pipeline
// never carried.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { enrichBaselineDocumentWithUnits } from '../../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { enrichPostInterventionDocumentWithUnits } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import { extractHabitatData } from '../baseline/extract-habitat-data.js'
import { extractPostIntervention } from '../post-intervention/extract-post-intervention.js'
import { readStagedGeoPackage } from './read-staged-geopackage.js'
import { assignStagedFeatureIds } from './staged-feature-ids.js'
import { stagedToLegacyLayers } from './staged-to-legacy.js'

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

/**
 * Stand-in for calculateHabitatSizes so the pipeline runs without PostGIS.
 * The VAH assertions never read these — a vertical area's size comes from its
 * hand-entered Area column, not from geometry.
 */
function fakeHabitatSizes(layers, { areaSqM, linearM }) {
  const areaEntry = (feature) => ({
    featureId: feature.featureId,
    sizeSquareMetres: areaSqM
  })
  const linearEntry = (feature) => ({
    featureId: feature.featureId,
    sizeMetres: linearM
  })
  return {
    areaHabitats: {
      individualSquareMetres: layers.areas.map(areaEntry),
      totalSquareMetres: areaSqM * layers.areas.length
    },
    hedgerows: {
      individualMetres: layers.hedgerows.map(linearEntry),
      totalMetres: linearM * layers.hedgerows.length
    },
    watercourses: {
      individualMetres: layers.watercourses.map(linearEntry),
      totalMetres: linearM * layers.watercourses.length
    }
  }
}

function extractBothStagesFromFixture() {
  const staged = assignStagedFeatureIds(readStagedGeoPackage(FIXTURE))
  const { baseline, postIntervention } = stagedToLegacyLayers(staged)

  const baselineExtract = extractHabitatData(baseline, {
    variant: 'baseline',
    habitatSizes: fakeHabitatSizes(baseline, { areaSqM: 10_000, linearM: 100 })
  })
  enrichBaselineDocumentWithUnits(baselineExtract.document)

  const piExtract = extractPostIntervention(postIntervention, {
    habitatSizes: fakeHabitatSizes(postIntervention, {
      areaSqM: 8750,
      linearM: 100
    })
  })
  enrichPostInterventionDocumentWithUnits(piExtract.document)
  return { baselineExtract, piExtract }
}

describe('vertical area habitats end to end (no DB)', () => {
  const { baselineExtract, piExtract } = extractBothStagesFromFixture()

  it('sizes the baseline wall by its hand-entered face area and calculates its units', () => {
    // Fixture row VAH-1: Urban / Ground based green wall, Low, "3. Moderate",
    // Area 150 m². Hand-computed: 0.015 ha × 2 (Low) × 2 (Moderate) × 1
    // (strategic significance) = 0.06 units.
    expect(baselineExtract.document.verticalAreas).toHaveLength(1)
    expect(baselineExtract.document.verticalAreas[0]).toMatchObject({
      ref: 'VAH-1',
      type: 'Ground based green wall',
      broadType: 'Urban',
      condition: 'Moderate',
      area: 150,
      sizeSquareMetres: 150,
      status: 'Complete',
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      conditionScore: 2,
      units: 0.06
    })
  })

  it('calculates the Enhanced post-intervention wall from the fixture', () => {
    // Fixture row VAH-1 (PI): Enhanced, Ground based green wall "3. Moderate"
    // → Facade-bound green wall "1. Good", Area 250 m². Hand-computed per the
    // enhancement formula:
    //   PI value        0.025 ha × 2 (Low) × 3 (Good)     = 0.15
    //   baseline value  0.025 ha × 2 (Low) × 2 (Moderate) = 0.10
    //   time multiplier Moderate → Good = 2 years → 0.965² = 0.931225
    //   difficulty      Facade-bound green wall = Medium  → 0.67
    //   units = (0.15 − 0.10) × (0.931225 × 0.67) + 0.10  = 0.1311960375
    expect(piExtract.document.verticalAreas).toHaveLength(1)
    const wall = piExtract.document.verticalAreas[0]
    expect(wall).toMatchObject({
      ref: 'VAH-1',
      retentionCategory: 'Enhanced',
      area: 250,
      sizeSquareMetres: 250,
      status: 'Complete',
      units: 0.1311960375
    })
    expect(wall.baseline.type).toBe('Ground based green wall')
    expect(wall.proposed.type).toBe('Facade-bound green wall')
  })

  it('rolls vertical area units into the totals under verticalAreasTotal', () => {
    const { units } = baselineExtract.document
    expect(units.verticalAreasTotal).toBe(0.06)
    expect(units.totalUnits).toBeCloseTo(
      units.habitatsTotal +
        units.hedgerowsTotal +
        units.watercoursesTotal +
        units.treesTotal +
        units.verticalAreasTotal,
      10
    )
    expect(piExtract.document.units.verticalAreasTotal).toBe(0.1311960375)
  })

  it('leaves single-stage documents without any verticalAreas key or total', () => {
    const legacyExtract = extractHabitatData(
      { redline: [], areas: [], hedgerows: [], watercourses: [], trees: [] },
      { variant: 'baseline' }
    )
    enrichBaselineDocumentWithUnits(legacyExtract.document)

    expect('verticalAreas' in legacyExtract.document).toBe(false)
    expect('verticalAreas' in legacyExtract.geometries).toBe(false)
    expect('verticalAreasTotal' in legacyExtract.document.units).toBe(false)
  })
})
