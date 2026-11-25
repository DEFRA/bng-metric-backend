import { afterEach, expect, it } from 'vitest'
// Every suite here uploads a legacy file, so runs with the service-template
// flag off only.
import { describeLegacy as describe } from '../test/helpers/template-mode.js'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

import { baselineFeatureOrangeFlags } from '../src/utilities/enrichment/baseline/baseline-orange-flags.js'
import { postInterventionFeatureOrangeFlags } from '../src/utilities/enrichment/post-intervention/post-intervention-orange-flags.js'
import { HTTP_OK } from './helpers/http-status.js'
import { fixturePath } from './helpers/upload-fixtures.js'
import {
  FIXTURE,
  callPostInterventionValidate,
  callValidate,
  createProject,
  fetchProject,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

const COMBINED_FIXTURE = 'post-intervention-combined.gpkg'
const LAYERS = [
  'habitats',
  'trees',
  'verticalHabitats',
  'hedgerows',
  'watercourses'
]
const temporaryDirectories = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/**
 * The baseline fixture with parcel H2 a "Fairly Good" grassland and the ditch
 * R1 "Fairly Poor", so each raises FLAG7. Attribute-only: geometry is untouched.
 */
async function fairlyBaselineFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'bmd822-'))
  temporaryDirectories.push(directory)
  const file = path.join(directory, 'orange-flags.gpkg')
  await copyFile(fixturePath(FIXTURE), file)
  const db = new Database(file)
  try {
    // SQLite resolves the rtree triggers' spatial functions while preparing an
    // attribute-only update; they must never run, as geometry stays fixed.
    for (const name of [
      'ST_IsEmpty',
      'ST_MinX',
      'ST_MaxX',
      'ST_MinY',
      'ST_MaxY'
    ]) {
      db.function(name, { varargs: true }, () => {
        throw new Error('Orange flag fixture changed geometry')
      })
    }
    db.prepare(
      `UPDATE Habitats SET "Baseline Habitat Type" = 'Other neutral grassland', "Baseline Condition" = '2. Fairly Good' WHERE "Parcel Ref" = 'H2'`
    ).run()
    db.prepare(
      `UPDATE Rivers SET "Baseline Condition" = '4. Fairly Poor' WHERE "Parcel Ref" = 'R1'`
    ).run()
  } finally {
    db.close()
  }
  return uploadFixture(FIXTURE, file)
}

function featuresOf(document) {
  return LAYERS.flatMap((layer) =>
    (document?.[layer] ?? []).map((feature) => ({ layer, feature }))
  )
}

function flagsByRef(document, layer) {
  return Object.fromEntries(
    (document[layer] ?? []).map((feature) => [feature.ref, feature.orangeFlags])
  )
}

describe('orange flags (BMD-822)', () => {
  it('saves every habitat its orange flags on a post-intervention import', async () => {
    const project = await createProject('Integration test - orange flags')
    const uploadId = await uploadFixture(COMBINED_FIXTURE)

    const res = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(res.statusCode).toBe(HTTP_OK)

    const stored = await fetchProject(project.id)
    // Advisory only (AC11): the file is accepted and still priced.
    expect(stored.postIntervention.units.totalUnits).toEqual(expect.any(Number))

    // Each flag read back is the one its stored fields derive.
    for (const { layer, feature } of featuresOf(stored.baseline)) {
      expect(feature.orangeFlags, `baseline ${layer} ${feature.ref}`).toEqual(
        baselineFeatureOrangeFlags(feature, layer)
      )
    }
    for (const { layer, feature } of featuresOf(stored.postIntervention)) {
      expect(
        feature.orangeFlags,
        `post-intervention ${layer} ${feature.ref}`
      ).toEqual(postInterventionFeatureOrangeFlags(feature, layer))
    }

    // Real rows of the fixture: a "Fairly" baseline condition (AC7), head
    // starts that reach target (AC1) or fall short of Poor (AC3), a "30+"
    // standard time (AC9), an Enhanced habitat's "Fairly" proposed condition,
    // and a Retained habitat, which raises none.
    expect(flagsByRef(stored.baseline, 'habitats').H016).toEqual(['FLAG7'])
    expect(flagsByRef(stored.postIntervention, 'habitats')).toMatchObject({
      H004: ['FLAG1', 'FLAG6'],
      H039: ['FLAG3', 'FLAG7'],
      H042: ['FLAG3', 'FLAG9'],
      H014: ['FLAG7'],
      H016: []
    })
  })

  it('replaces a baseline import’s flags when the baseline is uploaded again (AC14)', async () => {
    const project = await createProject(
      'Integration test - orange flags re-import'
    )

    const first = await callValidate(await fairlyBaselineFixture(), {
      projectId: project.id
    })
    expect(first.statusCode).toBe(HTTP_OK)
    const flagged = await fetchProject(project.id)
    expect(flagsByRef(flagged.baseline, 'habitats').H2).toEqual(['FLAG7'])
    expect(flagsByRef(flagged.baseline, 'watercourses').R1).toEqual(['FLAG7'])

    const second = await callValidate(await uploadFixture(FIXTURE), {
      projectId: project.id
    })
    expect(second.statusCode).toBe(HTTP_OK)
    const replaced = await fetchProject(project.id)
    expect(flagsByRef(replaced.baseline, 'habitats')).toEqual({
      H1: [],
      H2: [],
      H3: []
    })
    expect(flagsByRef(replaced.baseline, 'watercourses').R1).toEqual([])
  })
})
