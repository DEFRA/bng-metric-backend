import Database from 'better-sqlite3'
import { expect, it } from 'vitest'

import { describeServiceTemplate } from '../test/helpers/template-mode.js'
import { ERROR_CODES } from '../src/validation/geopackage/errors.js'
import { HTTP_OK } from './helpers/http-status.js'
import { fixturePath } from './helpers/upload-fixtures.js'
import {
  callValidate,
  createProject,
  fetchProject,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

const BOTH_STAGES = 'service-template/plain-site.gpkg'
const BASELINE_STAGE = 'service-template/large-site-baseline.gpkg'

/** Habitat Ref and feature_uuid of every row of a fixture's table. */
function baselineRows(fixture, table) {
  const db = new Database(fixturePath(fixture), { readonly: true })
  try {
    return db
      .prepare(
        `SELECT "Habitat Ref" AS ref, feature_uuid AS uuid FROM "${table}" ORDER BY fid`
      )
      .all()
  } finally {
    db.close()
  }
}

const featuresOf = (features) =>
  features.map(({ ref, properties }) => ({
    ref,
    uuid: properties.feature_uuid
  }))

const featureIdsOf = (baseline) =>
  ['habitats', 'hedgerows', 'watercourses'].flatMap((layer) =>
    baseline[layer].map(({ featureId }) => featureId)
  )

describeServiceTemplate(
  'BNG Service template at the baseline endpoint — with the service-template flag on',
  () => {
    it.each([
      ['a file holding both stages', BOTH_STAGES],
      ['a baseline-stage file', BASELINE_STAGE]
    ])(
      'reads %s from its Baseline tables, and stores the baseline',
      async (_, fixture) => {
        const project = await createProject('Service template baseline')
        const uploadId = await uploadFixture(fixture)

        const res = await callValidate(uploadId, { projectId: project.id })

        expect(res.statusCode).toBe(HTTP_OK)
        expect(res.result).toEqual({ valid: true, errors: [] })

        const { baseline, postIntervention } = await fetchProject(project.id)
        expect(postIntervention).toBeUndefined()
        expect(baseline.redLine.featureId).toEqual(expect.any(String))

        // Each feature is the Baseline table's row, identified by its own
        // feature_uuid: the Post-Intervention tables are not read.
        for (const [layer, table] of [
          ['habitats', 'Area Habitats Baseline'],
          ['hedgerows', 'Hedgerows Baseline'],
          ['watercourses', 'Watercourses Baseline']
        ]) {
          expect(featuresOf(baseline[layer])).toEqual(
            baselineRows(fixture, table)
          )
        }

        expect(baseline.habitats.every((h) => h.status === 'Complete')).toBe(
          true
        )
        expect(baseline.units.totalUnits).toBeGreaterThan(0)
      }
    )

    it('keeps each feature’s identity when the file is uploaded again', async () => {
      const project = await createProject('Service template re-upload')
      await callValidate(await uploadFixture(BOTH_STAGES), {
        projectId: project.id
      })
      const first = await fetchProject(project.id)

      await callValidate(await uploadFixture(BOTH_STAGES), {
        projectId: project.id
      })
      const second = await fetchProject(project.id)

      expect(second.baseline.habitats).toEqual(
        first.baseline.habitats.map((habitat) =>
          expect.objectContaining({
            featureId: habitat.featureId,
            properties: expect.objectContaining({
              feature_uuid: habitat.properties.feature_uuid
            })
          })
        )
      )
    })

    // The geometry tables' primary key spans every project, so a file's own
    // feature uuids cannot be the stored ids: one file in two projects would
    // collide.
    it('saves the same file to two projects, each with ids of its own', async () => {
      const projects = [
        await createProject('Service template project A'),
        await createProject('Service template project B')
      ]
      for (const project of projects) {
        const res = await callValidate(await uploadFixture(BOTH_STAGES), {
          projectId: project.id
        })
        expect(res.result).toEqual({ valid: true, errors: [] })
      }

      const [a, b] = await Promise.all(
        projects.map(
          async (project) => (await fetchProject(project.id)).baseline
        )
      )
      expect(featuresOf(b.habitats)).toEqual(featuresOf(a.habitats))
      const idsOfA = new Set(featureIdsOf(a))
      expect(featureIdsOf(b).filter((id) => idsOfA.has(id))).toEqual([])
    })

    it.each([
      [
        'a blank Habitat Ref, naming the table and row',
        'service-template/missing-habitat-ref.gpkg',
        {
          code: ERROR_CODES.HABITAT_REF_MISSING,
          message: expect.stringContaining(
            'Every habitat must have a Habitat Ref: Area Habitats Baseline fid'
          )
        }
      ],
      [
        'a habitat out of the service’s scope',
        'service-template/distinctiveness-out-of-scope.gpkg',
        { code: ERROR_CODES.HABITAT_DISTINCTIVENESS_NOT_IN_SCOPE }
      ],
      [
        'a file with no area habitats',
        'service-template/no-habitats.gpkg',
        { code: ERROR_CODES.NO_HABITAT_AREAS }
      ]
    ])('refuses %s, and stores nothing', async (_, fixture, error) => {
      const project = await createProject('Service template refused')
      const uploadId = await uploadFixture(fixture)

      const res = await callValidate(uploadId, { projectId: project.id })

      expect(res.statusCode).toBe(HTTP_OK)
      expect(res.result.valid).toBe(false)
      expect(res.result.errors).toContainEqual(expect.objectContaining(error))

      const stored = await fetchProject(project.id)
      expect(stored.baseline).toBeUndefined()
    })
  }
)
