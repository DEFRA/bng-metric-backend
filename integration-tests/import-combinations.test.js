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

async function changedFixture(statements) {
  const directory = await mkdtemp(path.join(tmpdir(), 'bmd1060-'))
  temporaryDirectories.push(directory)
  const file = path.join(directory, FIXTURE)
  await copyFile(fixturePath(FIXTURE), file)
  const db = new Database(file)
  try {
    // SQLite resolves rtree trigger functions for attribute-only updates.
    // Fail if any trigger actually tries to change the unchanged geometry.
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
    for (const sql of statements) {
      db.prepare(sql).run()
    }
  } finally {
    db.close()
  }
  return uploadFixture(FIXTURE, file)
}

describe('BMD-1060 persisted GeoPackage combinations', () => {
  it('AC1 cleans the derived baseline and PI baseline independently of valid proposed habitat', async () => {
    const project = await createProject('BMD-1060 combined baseline cascade')
    const upload = await changedFixture([
      `UPDATE Habitats SET "Retention Category" = 'Lost', "Baseline Broad Habitat Type" = 'Urban', "Baseline Habitat Type" = 'Modified grassland', "Baseline Condition" = 'Good', "Proposed Broad Habitat Type" = 'Grassland', "Proposed Habitat Type" = 'Modified grassland', "Proposed Condition" = 'Good', "Proposed Strategic Significance" = 'Low', "Habitat created in advance/years" = '2', "Delay in starting habitat creation/years" = '3' WHERE "Parcel Ref" = 'H1'`
    ])
    const response = await callPostInterventionValidate(upload, {
      projectId: project.id
    })
    expect(response.result).toEqual({ valid: true, errors: [] })
    const { baseline, postIntervention } = await fetchProject(project.id)
    const baselineFeature = baseline.habitats.find(({ ref }) => ref === 'H1')
    const proposedFeature = postIntervention.habitats.find(
      ({ ref }) => ref === 'H1'
    )
    expect(baselineFeature).toMatchObject({
      broadType: 'Urban',
      type: null,
      condition: null,
      habitatCreatedInAdvanceYears: null,
      delayInStartingHabitatCreationYears: null,
      status: 'Incomplete'
    })
    expect(proposedFeature.baseline).toMatchObject({
      broadType: 'Urban',
      type: null,
      condition: null
    })
    expect(proposedFeature.proposed).toMatchObject({
      broadType: 'Grassland',
      type: 'Modified grassland',
      condition: 'Good',
      advanceYears: null,
      delayYears: null
    })
    expect(proposedFeature.status).toBe('Complete')
    expect(proposedFeature.units).toBeGreaterThan(0)
    expect(proposedFeature.properties['Habitat created in advance/years']).toBe(
      '2'
    )
    expect(baselineFeature.properties).toEqual(proposedFeature.properties)
  })

  it.each(['Created', 'Enhanced', 'Retained'])(
    'AC3/AC5 persist null timing on linear %s habitats without nulling their valid identity',
    async (retention) => {
      const project = await createProject(`BMD-1060 linear ${retention}`)
      const upload = await changedFixture([
        `UPDATE Hedgerows SET "Retention Category" = '${retention}', "Baseline Hedge Type" = 'Native hedgerow', "Baseline Condition" = 'Moderate', "Proposed Hedge Type" = 'Native hedgerow', "Proposed Condition" = 'Good', "Proposed Strategic Significance" = 'Low', "Habitat created in advance/years" = '2', "Delay in starting habitat creation/years" = '3' WHERE "Parcel Ref" = 'H1'`,
        `UPDATE Rivers SET "Retention Category" = '${retention}', "Baseline River Type" = 'Ditches', "Baseline Condition" = 'Moderate', "Baseline Encroachment into Watercourse" = 'No Encroachment', "Baseline Encroachment into riparian zone" = 'No Encroachment/No Encroachment', "Proposed River Type" = 'Ditches', "Proposed Condition" = 'Good', "Proposed Strategic Significance" = 'Low', "Proposed Encroachment into Watercourse" = 'No Encroachment', "Proposed Encroachment into riparian zone" = 'No Encroachment/No Encroachment', "Habitat created in advance/years" = '2', "Delay in starting habitat creation/years" = '3' WHERE "Parcel Ref" = 'R1'`
      ])
      const response = await callPostInterventionValidate(upload, {
        projectId: project.id
      })
      expect(response.result).toEqual({ valid: true, errors: [] })
      const { postIntervention } = await fetchProject(project.id)
      for (const [layer, ref, type] of [
        ['hedgerows', 'H1', 'Native hedgerow'],
        ['watercourses', 'R1', 'Ditches']
      ]) {
        const feature = postIntervention[layer].find(
          (entry) => entry.ref === ref
        )
        expect(feature.proposed).toMatchObject({
          type,
          condition: 'Good',
          advanceYears: null,
          delayYears: null
        })
        if (retention === 'Retained' || retention === 'Lost') {
          expect(feature.status).toBe('Complete')
          expect(feature.units).toBeGreaterThan(0)
        } else {
          expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
        }
      }
    }
  )

  it.each([
    ['baseline', 'Baseline', callValidate],
    ['postIntervention', 'Proposed', callPostInterventionValidate]
  ])(
    'AC1/AC2 save inconsistent %s combinations as null',
    async (documentKey, prefix, validate) => {
      const project = await createProject(`BMD-1060 ${documentKey}`)
      const upload = await changedFixture([
        `UPDATE Habitats SET "${prefix} Broad Habitat Type" = 'Urban', "${prefix} Habitat Type" = 'Modified grassland', "${prefix} Condition" = 'Good' WHERE "Parcel Ref" = 'H1'`,
        `UPDATE Hedgerows SET "${prefix} Hedge Type" = 'Native hedgerow', "${prefix} Condition" = 'Fairly Good' WHERE "Parcel Ref" = 'H1'`,
        `UPDATE Rivers SET "${prefix} River Type" = 'Culvert', "${prefix} Condition" = 'Moderate' WHERE "Parcel Ref" = 'R1'`
      ])
      const response = await validate(upload, { projectId: project.id })
      expect(response.result).toEqual({ valid: true, errors: [] })
      const document = (await fetchProject(project.id))[documentKey]
      const side = (feature) =>
        documentKey === 'baseline' ? feature : feature.proposed
      const area = document.habitats.find((feature) => feature.ref === 'H1')
      expect(side(area)).toMatchObject({
        broadType: 'Urban',
        type: null,
        condition: null
      })
      expect(area).toMatchObject({ units: null, status: 'Incomplete' })
      expect(area.properties[`${prefix} Habitat Type`]).toBe(
        'Modified grassland'
      )
      const hedge = document.hedgerows.find((feature) => feature.ref === 'H1')
      expect(side(hedge)).toMatchObject({
        type: 'Native hedgerow',
        condition: null
      })
      const river = document.watercourses.find(
        (feature) => feature.ref === 'R1'
      )
      expect(side(river)).toMatchObject({ type: 'Culvert', condition: null })
      for (const feature of [hedge, river]) {
        expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
      }
    }
  )

  it.each([
    ['Created', "'2'", "'3'"],
    ['Created', 'NULL', 'NULL'],
    ['Enhanced', "'2'", "'3'"],
    ['Enhanced', 'NULL', 'NULL'],
    ['Retained', "'2'", "'0'"],
    ['Lost', "'2'", "'0'"]
  ])(
    'AC3-AC5 persist null timing for %s (%s, %s)',
    async (retention, advance, delay) => {
      const project = await createProject(`BMD-1060 timing ${retention}`)
      const upload = await changedFixture([
        `UPDATE Habitats SET "Retention Category" = '${retention}', "Baseline Broad Habitat Type" = 'Grassland', "Baseline Habitat Type" = 'Modified grassland', "Baseline Condition" = 'Moderate', "Proposed Broad Habitat Type" = 'Grassland', "Proposed Habitat Type" = 'Modified grassland', "Proposed Condition" = 'Good', "Proposed Strategic Significance" = 'Low', "Habitat created in advance/years" = ${advance}, "Delay in starting habitat creation/years" = ${delay} WHERE "Parcel Ref" = 'H1'`
      ])
      const response = await callPostInterventionValidate(upload, {
        projectId: project.id
      })
      expect(response.result).toEqual({ valid: true, errors: [] })
      const { postIntervention } = await fetchProject(project.id)
      const feature = postIntervention.habitats.find(
        (entry) => entry.ref === 'H1'
      )
      expect(feature.proposed).toMatchObject({
        advanceYears: null,
        delayYears: null
      })
      expect(feature.proposed.type).not.toBeNull()
      if (retention === 'Retained' || retention === 'Lost') {
        expect(feature.status).toBe('Complete')
        expect(feature.units).toBeGreaterThan(0)
      } else {
        expect(feature).toMatchObject({ units: null, status: 'Incomplete' })
      }
    }
  )
})
