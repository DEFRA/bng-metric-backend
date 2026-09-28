import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { loadScenarioCorpus } from 'bng-library/metric-compare'

import { findScenarioCorpus } from './find-scenario-corpus.js'
import { importGeoPackagePair } from './import-geopackage-pair.js'

// The scenario corpus is in the harness; a checkout of this repo alone skips.
const corpusDir = findScenarioCorpus()
const scenarios = corpusDir ? loadScenarioCorpus(corpusDir).scenarios : []
const scenario = (id) => scenarios.find((s) => s.id === id)

describe.skipIf(!corpusDir)('importGeoPackagePair', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'import-pair-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  it('imports an accepted pair into the project response GET /projects/{id} returns', async () => {
    const result = await importGeoPackagePair(
      scenario('trading-surplus-in-another-broad-habitat').files
    )

    expect(result.accepted).toBe(true)
    const { project, tradingRuleStatuses } = result.project
    expect(project.baseline.habitats.length).toBeGreaterThan(0)
    expect(project.baseline.units.habitatsTotal).toBeGreaterThan(0)
    expect(project.postIntervention.units.habitatsNetUnitChange).toEqual(
      expect.any(Number)
    )
    expect(project.postIntervention.tradingRules.areaHabitats).toBeDefined()
    expect(tradingRuleStatuses.areaHabitats.overall).toMatch(/^(Met|Not met)$/)
  })

  it('carries the baseline into the post-intervention enrichment', async () => {
    const result = await importGeoPackagePair(
      scenario('intervention-area-retained').files
    )

    const retained = result.project.project.postIntervention.habitats.filter(
      (h) => h.retentionCategory === 'Retained'
    )
    expect(retained.length).toBeGreaterThan(0)
    for (const habitat of retained) {
      expect(habitat.units).toEqual(expect.any(Number))
    }
  })

  it('reports the data-quality errors of a refused post-intervention file', async () => {
    const result = await importGeoPackagePair(
      scenario('invalid-area-advance-and-delay').files
    )

    expect(result).toMatchObject({
      accepted: false,
      rejectedFile: 'postIntervention'
    })
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('refuses a baseline that is not a GeoPackage at the format gate', async () => {
    const notAGeoPackage = path.join(scratch, 'not-a.gpkg')
    writeFileSync(notAGeoPackage, 'not a GeoPackage')

    const result = await importGeoPackagePair({
      baseline: notAGeoPackage,
      postIntervention: scenario('trading-all-met').files.postIntervention
    })

    expect(result).toMatchObject({ accepted: false, rejectedFile: 'baseline' })
    expect(result.errors[0].code).toEqual(expect.any(String))
  })
})
