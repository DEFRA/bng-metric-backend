import { expect, it } from 'vitest'

import { describeServiceTemplate } from '../test/helpers/template-mode.js'
import { ERROR_CODES } from '../src/validation/geopackage/errors.js'
import { HTTP_OK } from './helpers/http-status.js'
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
const AREA_BASELINE = 'Area Habitats Baseline'
const AREA_PI = 'Area Habitats Post-Intervention'

async function uploadCombined(projectId, fixture) {
  return callPostInterventionValidate(await uploadFixture(fixture), {
    projectId
  })
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

    it('leaves the baseline endpoint alone: it reads no post-intervention row to link', async () => {
      const project = await createProject('Lineage at the baseline endpoint')

      const res = await callValidate(await uploadFixture(UNKNOWN_PARENT), {
        projectId: project.id
      })

      expect(res.result).toEqual({ valid: true, errors: [] })
    })
  }
)
