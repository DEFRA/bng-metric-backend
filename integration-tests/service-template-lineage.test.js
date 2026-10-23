import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { describeServiceTemplate } from '../test/helpers/template-mode.js'
import { ERROR_CODES } from '../src/validation/geopackage/errors.js'
import { HTTP_OK } from './helpers/http-status.js'
import { fixturePath } from './helpers/upload-fixtures.js'
import {
  callPostInterventionValidate,
  callValidate,
  createProject,
  fetchProject,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

// The harness's lineage-problems/ files: the default site, with one
// post-intervention area habitat's parent link broken.
const NO_PARENT_LINK = 'service-template/lineage-parent-missing.gpkg'
const UNKNOWN_PARENT = 'service-template/lineage-parent-unknown.gpkg'
const SHAPE_CHANGED = 'service-template/lineage-parent-geom-mismatch.gpkg'
const SHAPE_MISSING = 'service-template/lineage-parent-geom-missing.gpkg'
const EVERY_COLUMN = 'service-template/default-site.gpkg'
const AREA_BASELINE = 'Area Habitats Baseline'
const AREA_PI = 'Area Habitats Post-Intervention'
const LINKED_LAYERS = ['habitats', 'hedgerows', 'watercourses']

let scratch
beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'service-template-lineage-'))
})
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

async function uploadCombined(projectId, fixture, filePath) {
  return callPostInterventionValidate(await uploadFixture(fixture, filePath), {
    projectId
  })
}

/** A copy of the default site with one post-intervention row's ref renamed. */
function withRenamedRef(table, fid, ref) {
  const filePath = path.join(scratch, `renamed-${table}-${fid}.gpkg`)
  copyFileSync(fixturePath(EVERY_COLUMN), filePath)
  const db = new Database(filePath)
  try {
    db.prepare(`UPDATE "${table}" SET "Habitat Ref" = ? WHERE fid = ?`).run(
      ref,
      fid
    )
  } finally {
    db.close()
  }
  return filePath
}

describeServiceTemplate(
  'BNG Service template parent links at the baseline + post-intervention endpoint — with the service-template flag on',
  () => {
    it('refuses a Retained or Enhanced row that names no parent, naming the row, and stores nothing', async () => {
      const project = await createProject('Lineage no parent link')

      const res = await uploadCombined(project.id, NO_PARENT_LINK)

      expect(res.result).toEqual({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.STAGED_PARENT_LINK_MISSING,
            stage: 'post-intervention',
            details: {
              count: 1,
              sample: [
                expect.objectContaining({
                  table: AREA_PI,
                  ref: 'H001',
                  habitatType: expect.any(String)
                })
              ]
            }
          })
        ]
      })
      expect((await fetchProject(project.id)).postIntervention).toBeUndefined()
    })

    it('refuses a row whose parent is not in the baseline, naming the row, and stores nothing', async () => {
      const project = await createProject('Lineage unknown parent')

      const res = await uploadCombined(project.id, UNKNOWN_PARENT)

      expect(res.statusCode).toBe(HTTP_OK)
      expect(res.result).toEqual({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.STAGED_UNKNOWN_PARENT_REF,
            stage: 'post-intervention',
            details: {
              count: 1,
              sample: [
                expect.objectContaining({
                  table: AREA_PI,
                  ref: 'H001',
                  habitatType: expect.any(String)
                })
              ]
            }
          })
        ]
      })
      const stored = await fetchProject(project.id)
      expect(stored.baseline).toBeUndefined()
      expect(stored.postIntervention).toBeUndefined()
    })

    it.each([
      ['whose shape has changed since the copy', SHAPE_CHANGED],
      ['whose copy recorded no shape', SHAPE_MISSING]
    ])(
      'refuses a parent %s, naming the parent and its rows, and stores nothing',
      async (_, fixture) => {
        const project = await createProject('Lineage parent shape')

        const res = await uploadCombined(project.id, fixture)

        expect(res.result).toEqual({
          valid: false,
          errors: [
            expect.objectContaining({
              code: ERROR_CODES.STAGED_BASELINE_DRIFTED,
              stage: 'post-intervention',
              details: {
                count: 1,
                sample: [
                  expect.objectContaining({
                    table: AREA_BASELINE,
                    ref: 'H001',
                    habitatType: expect.any(String),
                    childRefs: ['H001']
                  })
                ]
              }
            })
          ]
        })
        expect(
          (await fetchProject(project.id)).postIntervention
        ).toBeUndefined()
      }
    )

    it('gives each linked post-intervention feature its parent’s featureId, and an unlinked one none', async () => {
      const project = await createProject('Lineage parent featureId')

      const res = await uploadCombined(project.id, EVERY_COLUMN)

      expect(res.result).toEqual({ valid: true, errors: [] })
      const { baseline, postIntervention } = await fetchProject(project.id)
      let linked = 0
      for (const layer of LINKED_LAYERS) {
        const parentIdByUuid = new Map(
          baseline[layer].map((f) => [f.properties.feature_uuid, f.featureId])
        )
        for (const feature of postIntervention[layer]) {
          const parentId = parentIdByUuid.get(feature.properties.parent_uuid)
          expect(feature.parentFeatureId, `${layer} ${feature.ref}`).toBe(
            parentId
          )
          linked += parentId ? 1 : 0
        }
      }
      expect(linked).toBeGreaterThan(0)
    })

    // The parent's measured length, found through the link: a child's ref
    // need not be its parent's.
    it.each([
      ['hedgerows', 'Hedgerows Post-Intervention', 2, 'HG002'],
      ['watercourses', 'Watercourses Post-Intervention', 5, 'R006']
    ])(
      'prices an Enhanced %s feature whose ref is not its parent’s as if it were',
      async (layer, table, fid, ref) => {
        const asFiled = await createProject('Lineage ref as filed')
        const renamed = await createProject('Lineage ref renamed')
        await uploadCombined(asFiled.id, EVERY_COLUMN)

        const res = await uploadCombined(
          renamed.id,
          EVERY_COLUMN,
          withRenamedRef(table, fid, `${ref}-renamed`)
        )

        expect(res.result).toEqual({ valid: true, errors: [] })
        const priced = (project) =>
          project.postIntervention[layer].find((f) => f.properties.fid === fid)
        const expected = priced(await fetchProject(asFiled.id))
        const actual = priced(await fetchProject(renamed.id))
        expect(actual.ref).toBe(`${ref}-renamed`)
        expect(actual.status).toBe('Complete')
        expect(actual.units).toBe(expected.units)
      }
    )

    it('leaves the baseline endpoint alone: it reads no post-intervention row to link', async () => {
      const project = await createProject('Lineage at the baseline endpoint')

      const res = await callValidate(await uploadFixture(UNKNOWN_PARENT), {
        projectId: project.id
      })

      expect(res.result).toEqual({ valid: true, errors: [] })
    })
  }
)
