import { afterEach, expect, it } from 'vitest'
// Every suite here uploads a legacy file, so runs with the service-template
// flag off only.
import { describeLegacy as describe } from '../test/helpers/template-mode.js'
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
    ).run('Woodland and forest', 'Modified grassland', ' \t ')
    db.prepare(
      `UPDATE Hedgerows SET "${prefix} Hedge Type" = ?, "${prefix} Condition" = ? WHERE "Parcel Ref" = 'H1'`
    ).run(null, 'Good')
    db.prepare(
      `UPDATE Rivers SET "${prefix} River Type" = ?, "${prefix} Condition" = ?, "${prefix} Encroachment into Watercourse" = ?, "${prefix} Encroachment into riparian zone" = ? WHERE "Parcel Ref" = 'R1'`
    ).run(
      proposed ? null : 'Ditches',
      proposed ? 'Good' : 'N/A - Other',
      null,
      ' \t '
    )
    if (mode === 'populated') {
      db.prepare(
        `UPDATE Habitats SET "${prefix} Condition" = 'Good' WHERE "Parcel Ref" = 'H1'`
      ).run()
      db.prepare(
        `UPDATE Hedgerows SET "${prefix} Hedge Type" = 'Native hedgerow', "${prefix} Condition" = 'N/A - Other' WHERE "Parcel Ref" = 'H1'`
      ).run()
      db.prepare(
        `UPDATE Rivers SET "${prefix} River Type" = 'Ditches', "${prefix} Condition" = 'N/A - Other', "${prefix} Encroachment into Watercourse" = 'No Encroachment', "${prefix} Encroachment into riparian zone" = 'No Encroachment/No Encroachment' WHERE "Parcel Ref" = 'R1'`
      ).run()
    }
    if (proposed) {
      db.prepare(
        `UPDATE Habitats SET "Proposed Strategic Significance" = 'High', "Habitat created in advance/years" = '2', "Delay in starting habitat creation/years" = '0' WHERE "Parcel Ref" = 'H1'`
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
    if (mode === 'as-the-gate-reads') {
      db.prepare(
        `UPDATE Habitats SET "Site Name" = ?, "Retention Category" = 'Retained ', "Habitat created in advance/years" = '5.0' WHERE "Parcel Ref" = 'H1'`
      ).run(`${'s'.repeat(999)}   `)
      db.prepare(
        `UPDATE Hedgerows SET "Habitat created in advance/years" = 'N/A' WHERE "Parcel Ref" = 'H1'`
      ).run()
      db.prepare(
        `UPDATE Rivers SET "Habitat created in advance/years" = 'Habitat already in target condition' WHERE "Parcel Ref" = 'R1'`
      ).run()
    }
    if (mode === 'not-in-list') {
      db.prepare(
        `UPDATE Habitats SET "Baseline Condition" = 'Splendid' WHERE "Parcel Ref" = 'H1'`
      ).run()
    }
    if (mode === 'retained-invalid') {
      db.prepare(
        `UPDATE Hedgerows SET "Baseline Condition" = 'N/A - Other', "Proposed Condition" = '   ' WHERE "Parcel Ref" = 'H1'`
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
    'saves blank values, and list values that do not fit their row, without rejecting a %s upload',
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
      // A real broad habitat that does not hold the habitat type keeps the
      // broad habitat and loses the type.
      expect(side(area)).toMatchObject({
        broadType: 'Woodland and forest',
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
        // A significance that is in its list is kept; one that is not in
        // any list is refused at upload (BMD-1175).
        expect(area.proposed).toMatchObject({
          strategicSignificance: 'High',
          advanceYears: null,
          delayYears: null
        })
        expect(area.baseline.type).toBe('Developed land; sealed surface')
        expect(area.baseline.condition).toBe('N/A - Other')
      } else {
        // Baseline is stored as Low whatever the file says (BMD-1086); the
        // file's value stays in the raw properties.
        expect(area.strategicSignificance).toBe('Low')
        expect(area.properties['Baseline Strategic Significance']).toBe(
          'Area/compensation not in local strategy/ no local strategy'
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
    'persists Incomplete status for %s attributes that do not fit their row',
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

  // A value that no list offers at all is refused before anything is read
  // (BMD-1175); one that is in a list but does not fit its row is still
  // saved as null, as above.
  it('refuses a value no list offers, and saves nothing', async () => {
    const project = await createProject('BMD-1175 value not in any list')
    const before = await fetchProject(project.id)
    const uploadId = await changedFixture(false, 'not-in-list')
    const refused = await callValidate(uploadId, { projectId: project.id })
    expect(refused.statusCode).toBe(200)
    expect(refused.result.valid).toBe(false)
    expect(refused.result.errors).toEqual([
      expect.objectContaining({
        code: 'VALUE_NOT_ALLOWED',
        details: {
          count: 1,
          sample: [
            expect.objectContaining({
              table: 'Habitats',
              ref: 'H1',
              column: 'Baseline Condition',
              value: 'Splendid'
            })
          ]
        }
      })
    ])
    expect(await fetchProject(project.id)).toEqual(before)
  })

  // The upload checks a value once trimmed, and as a list word once a list
  // number, case, spacing and a whole-number decimal are set aside; the saved
  // document is checked the same way, so such a file saves (BMD-1175).
  it('saves values padded with spaces, "5.0", "N/A" and "Habitat already in target condition"', async () => {
    const project = await createProject(
      'BMD-1175 values as the gate reads them'
    )
    const uploadId = await changedFixture(false, 'as-the-gate-reads')
    const response = await callValidate(uploadId, { projectId: project.id })
    expect(response.result).toEqual({ valid: true, errors: [] })
    const { baseline } = await fetchProject(project.id)
    const area = baseline.habitats.find((feature) => feature.ref === 'H1')
    expect(area.properties['Habitat created in advance/years']).toBe('5.0')
    expect(area.retentionCategory).toBe('Retained ')
    expect(area.siteName).toBe(`${'s'.repeat(999)}   `)
  })

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

  // BMD-1059 nulled an invalid baseline attribute copied onto a Retained row
  // and saved the file. The derived baseline hedgerow is then incomplete, so
  // BMD-1195 refuses the file and saves nothing from it.
  it('refuses a post-intervention file whose retained baseline attribute is invalid (BMD-1195)', async () => {
    const project = await createProject('BMD-1195 retained invalid attributes')
    const uploadId = await changedFixture(true, 'retained-invalid')
    const response = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(response.statusCode).toBe(200)
    expect(response.result).toEqual({
      valid: false,
      errors: [
        expect.objectContaining({
          code: 'BASELINE_HABITATS_INCOMPLETE',
          details: {
            count: 1,
            sample: [
              expect.objectContaining({ layer: 'hedgerows', feature_ref: 'H1' })
            ]
          }
        })
      ]
    })
    const stored = await fetchProject(project.id)
    expect(stored.baseline).toBeUndefined()
    expect(stored.postIntervention).toBeUndefined()
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
