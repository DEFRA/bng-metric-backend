import { afterEach, describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

import { fixturePath } from './helpers/upload-fixtures.js'
import {
  FIXTURE,
  callValidate,
  callPostInterventionValidate,
  createProject,
  fetchProject,
  fetchProjectAudit,
  fetchLayerRows,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()
const temporaryDirectories = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function changedFixture(proposed = false, mode = 'nulls') {
  const directory = await mkdtemp(path.join(tmpdir(), 'bmd1059-'))
  temporaryDirectories.push(directory)
  const file = path.join(directory, 'import-attributes.gpkg')
  await copyFile(fixturePath(FIXTURE), file)
  const db = new Database(file)
  try {
    // SQLite resolves spatial functions while preparing attribute-only updates.
    // These rtree trigger branches must never run: geometry and fid stay fixed.
    for (const name of [
      'ST_IsEmpty',
      'ST_MinX',
      'ST_MaxX',
      'ST_MinY',
      'ST_MaxY'
    ]) {
      db.function(name, { varargs: true }, () => {
        throw new Error('Attribute fixture changed geometry')
      })
    }
    const prefix = proposed ? 'Proposed' : 'Baseline'
    // Identifiers are fixed test constants. Values use SQLite parameters.
    db.prepare(
      `UPDATE Habitats SET "${prefix} Broad Habitat Type" = ?, "${prefix} Habitat Type" = ?, "${prefix} Condition" = ? WHERE "Parcel Ref" = 'H1'`
    ).run('not a broad habitat', 'Modified grassland', ' \t ')
    db.prepare(
      `UPDATE Hedgerows SET "${prefix} Hedge Type" = ?, "${prefix} Condition" = ? WHERE "Parcel Ref" = 'H1'`
    ).run(null, 'Good')
    db.prepare(
      `UPDATE Rivers SET "${prefix} River Type" = ?, "${prefix} Condition" = ?, "${prefix} Encroachment into Watercourse" = ?, "${prefix} Encroachment into riparian zone" = ? WHERE "Parcel Ref" = 'R1'`
    ).run(
      proposed ? null : 'Ditches',
      proposed ? 'Good' : 'unknown condition',
      null,
      ' \t '
    )
    if (mode === 'populated') {
      db.prepare(
        `UPDATE Habitats SET "${prefix} Condition" = 'Good' WHERE "Parcel Ref" = 'H1'`
      ).run()
      db.prepare(
        `UPDATE Hedgerows SET "${prefix} Hedge Type" = 'Native hedgerow', "${prefix} Condition" = 'unknown condition' WHERE "Parcel Ref" = 'H1'`
      ).run()
      db.prepare(
        `UPDATE Rivers SET "${prefix} River Type" = 'Ditches', "${prefix} Condition" = 'unknown condition', "${prefix} Encroachment into Watercourse" = 'No Encroachment', "${prefix} Encroachment into riparian zone" = 'No Encroachment/No Encroachment' WHERE "Parcel Ref" = 'R1'`
      ).run()
    }
    if (proposed) {
      db.prepare(
        `UPDATE Habitats SET "Proposed Strategic Significance" = 'keep source value', "Habitat created in advance/years" = '2', "Delay in starting habitat creation/years" = '0' WHERE "Parcel Ref" = 'H1'`
      ).run()
    }
    if (mode === 'retained' || mode === 'retained-invalid') {
      db.prepare(
        `UPDATE Habitats SET "Retention Category" = 'Retained', "Baseline Broad Habitat Type" = 'Grassland', "Baseline Habitat Type" = 'Modified grassland', "Baseline Condition" = 'Good', "Proposed Broad Habitat Type" = NULL, "Proposed Habitat Type" = NULL, "Proposed Condition" = NULL, "Proposed Strategic Significance" = NULL WHERE "Parcel Ref" = 'H1'`
      ).run()
      db.prepare(
        `UPDATE Hedgerows SET "Retention Category" = 'Retained', "Baseline Hedge Type" = 'Native hedgerow', "Baseline Condition" = 'Good', "Proposed Hedge Type" = NULL, "Proposed Condition" = NULL, "Proposed Strategic Significance" = NULL WHERE "Parcel Ref" = 'H1'`
      ).run()
      db.prepare(
        `UPDATE Rivers SET "Retention Category" = 'Retained', "Baseline River Type" = 'Ditches', "Baseline Condition" = 'Good', "Baseline Encroachment into Watercourse" = 'No Encroachment', "Baseline Encroachment into riparian zone" = 'No Encroachment/No Encroachment', "Proposed River Type" = NULL, "Proposed Condition" = NULL, "Proposed Encroachment into Watercourse" = NULL, "Proposed Encroachment into riparian zone" = NULL, "Proposed Strategic Significance" = NULL WHERE "Parcel Ref" = 'R1'`
      ).run()
    }
    if (mode === 'retained-invalid') {
      db.prepare(
        `UPDATE Hedgerows SET "Baseline Condition" = 'unknown condition', "Proposed Condition" = '   ' WHERE "Parcel Ref" = 'H1'`
      ).run()
    }
  } finally {
    db.close()
  }
  return uploadFixture(FIXTURE, file)
}

describe('BMD-1059 real GeoPackage imports', () => {
  it.each([
    ['baseline', false, callValidate, 'baseline_habitats'],
    [
      'postIntervention',
      true,
      callPostInterventionValidate,
      'post_intervention_habitats'
    ]
  ])(
    'saves nulls and invalid values without rejecting a %s upload',
    async (documentKey, proposed, validate, geometryTable) => {
      const project = await createProject(`BMD-1059 ${documentKey}`)
      const uploadId = await changedFixture(proposed)
      const response = await validate(uploadId, { projectId: project.id })
      expect(response.statusCode).toBe(200)
      expect(response.result).toEqual({ valid: true, errors: [] })
      const stored = (await fetchProject(project.id))[documentKey]
      const area = stored.habitats.find((feature) => feature.ref === 'H1')
      const hedge = stored.hedgerows.find((feature) => feature.ref === 'H1')
      const river = stored.watercourses.find((feature) => feature.ref === 'R1')
      const side = (feature) => (proposed ? feature.proposed : feature)
      expect(side(area)).toMatchObject({
        broadType: null,
        type: null,
        condition: null
      })
      expect(side(hedge)).toMatchObject({ type: null, condition: null })
      expect(side(river)).toMatchObject({
        type: proposed ? null : 'Ditches',
        condition: null,
        watercourseEncroachment: null,
        riparianEncroachment: null
      })
      if (proposed) {
        expect(area.proposed).toMatchObject({
          strategicSignificance: null,
          advanceYears: null,
          delayYears: null
        })
        expect(area.baseline.type).toBe('Developed land; sealed surface')
        expect(area.baseline.condition).toBe('N/A - Other')
      } else {
        expect(area.strategicSignificance).toBe(
          area.properties['Baseline Strategic Significance']
        )
        expect(river.waterEncroachmentMultiplier).toBeUndefined()
        expect(river.riparianEncroachmentMultiplier).toBeUndefined()
      }
      for (const feature of [area, hedge, river]) {
        expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
      }
      const geometries = await fetchLayerRows(geometryTable, project.id)
      expect(geometries.map((row) => row.id)).toContain(area.featureId)
      expect(geometries.every((row) => row.is_valid)).toBe(true)
      expect(
        (await fetchProjectAudit(project.id)).at(-1).project[documentKey]
      ).toEqual(stored)
    }
  )

  it.each([
    ['baseline', false, callValidate],
    ['postIntervention', true, callPostInterventionValidate]
  ])(
    'persists Incomplete status for nonempty invalid %s attributes',
    async (documentKey, proposed, validate) => {
      const project = await createProject(
        `BMD-1059 invalid status ${documentKey}`
      )
      const uploadId = await changedFixture(proposed, 'populated')
      expect(
        (await validate(uploadId, { projectId: project.id })).statusCode
      ).toBe(200)
      const stored = (await fetchProject(project.id))[documentKey]
      for (const [layer, ref] of [
        ['habitats', 'H1'],
        ['hedgerows', 'H1'],
        ['watercourses', 'R1']
      ]) {
        const feature = stored[layer].find((item) => item.ref === ref)
        expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
        expect((proposed ? feature.proposed : feature).condition).toBeNull()
      }
    }
  )

  it('saves retained baseline fallback with Complete status', async () => {
    const project = await createProject('BMD-1059 retained fallback')
    const uploadId = await changedFixture(true, 'retained')
    expect(
      (await callPostInterventionValidate(uploadId, { projectId: project.id }))
        .statusCode
    ).toBe(200)
    const stored = (await fetchProject(project.id)).postIntervention
    for (const [layer, ref] of [
      ['habitats', 'H1'],
      ['hedgerows', 'H1'],
      ['watercourses', 'R1']
    ]) {
      const feature = stored[layer].find((item) => item.ref === ref)
      expect(feature.proposed.type).toBe(feature.baseline.type)
      expect(feature.proposed.condition).toBe('Good')
      expect(feature.status).toBe('Complete')
      expect(feature.units).toEqual(expect.any(Number))
    }
  })

  it('nulls invalid copied baseline attributes on retained imports', async () => {
    const project = await createProject('BMD-1059 retained invalid attributes')
    const uploadId = await changedFixture(true, 'retained-invalid')
    expect(
      (await callPostInterventionValidate(uploadId, { projectId: project.id }))
        .statusCode
    ).toBe(200)
    const stored = (await fetchProject(project.id)).postIntervention
    const hedge = stored.hedgerows.find((feature) => feature.ref === 'H1')
    expect(hedge.baseline.condition).toBeNull()
    expect(hedge.proposed.condition).toBeNull()
    expect(hedge.properties['Proposed Condition']).toBe('   ')
  })

  it('keeps stable feature IDs for re-uploads', async () => {
    const project = await createProject('BMD-1059 repeated upload')
    const firstUpload = await changedFixture()
    expect(
      (await callValidate(firstUpload, { projectId: project.id })).statusCode
    ).toBe(200)
    const before = (await fetchProject(project.id)).baseline
    const secondUpload = await changedFixture()
    expect(
      (await callValidate(secondUpload, { projectId: project.id })).statusCode
    ).toBe(200)
    const after = (await fetchProject(project.id)).baseline
    expect(after.habitats.map((feature) => feature.featureId)).toEqual(
      before.habitats.map((feature) => feature.featureId)
    )
  })
})
