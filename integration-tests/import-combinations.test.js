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
      expect(area.status).toBe('Incomplete')
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
        `UPDATE Habitats SET "Retention Category" = '${retention}', "Baseline Broad Habitat Type" = 'Grassland', "Baseline Habitat Type" = 'Modified grassland', "Baseline Condition" = 'Moderate', "Proposed Broad Habitat Type" = 'Grassland', "Proposed Habitat Type" = 'Modified grassland', "Proposed Condition" = 'Good', "Habitat created in advance/years" = ${advance}, "Delay in starting habitat creation/years" = ${delay} WHERE "Parcel Ref" = 'H1'`
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
    }
  )
})
