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

const BOTH_STAGES = 'service-template/plain-site.gpkg'
const BASELINE_STAGE = 'service-template/large-site-baseline.gpkg'
const TEMPLATE_1_0 = { name: 'bng-service', version: '1.0' }
const LAYERS = [
  ['habitats', 'Area Habitats'],
  ['hedgerows', 'Hedgerows'],
  ['watercourses', 'Watercourses']
]

/** Each row's Habitat Ref, in order, from a fixture's table. */
function refsOf(filePath, table) {
  const db = new Database(filePath, { readonly: true })
  try {
    return db
      .prepare(`SELECT "Habitat Ref" AS ref FROM "${table}" ORDER BY fid`)
      .all()
      .map(({ ref }) => ref)
  } finally {
    db.close()
  }
}

const storedRefs = (document, layer) => document[layer].map(({ ref }) => ref)

let scratch
beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'service-template-combined-'))
})
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

let copies = 0

/** A copy of a fixture, to edit. */
function copyOf(fixture) {
  copies += 1
  const filePath = path.join(scratch, `edited-${copies}.gpkg`)
  copyFileSync(fixturePath(fixture), filePath)
  return filePath
}

/**
 * A copy of a fixture with one value of one row changed, so the file is
 * otherwise one the service accepts.
 */
function withValue(fixture, { table, fid, column, value }) {
  const filePath = copyOf(fixture)
  const db = new Database(filePath)
  try {
    db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE fid = ?`).run(
      value,
      fid
    )
  } finally {
    db.close()
  }
  return filePath
}

/** The metric's strategic significance multiplier for High; Low is 1. */
const HIGH_MULTIPLIER = 1.15
const UNITS_PRECISION = 9

async function uploadCombined(projectId, fixture, filePath) {
  const uploadId = await uploadFixture(fixture, filePath)
  return callPostInterventionValidate(uploadId, { projectId })
}

describeServiceTemplate(
  'BNG Service template at the baseline + post-intervention endpoint — with the service-template flag on',
  () => {
    it('reads the baseline from the Baseline tables and the post-intervention from the Post-Intervention tables, and stores both', async () => {
      const project = await createProject('Service template combined')

      const res = await uploadCombined(project.id, BOTH_STAGES)

      expect(res.statusCode).toBe(HTTP_OK)
      expect(res.result).toEqual({ valid: true, errors: [] })

      const { baseline, postIntervention } = await fetchProject(project.id)
      const file = fixturePath(BOTH_STAGES)
      for (const [layer, table] of LAYERS) {
        expect(storedRefs(baseline, layer)).toEqual(
          refsOf(file, `${table} Baseline`)
        )
        expect(storedRefs(postIntervention, layer)).toEqual(
          refsOf(file, `${table} Post-Intervention`)
        )
      }
      // The baseline is read, with each feature's own identity, not derived
      // from the post-intervention rows.
      expect(baseline.habitats.every((h) => h.properties.feature_uuid)).toBe(
        true
      )
      expect(baseline.units.totalUnits).toBeGreaterThan(0)
      expect(postIntervention.units).toEqual(expect.any(Object))
    })

    it('records the template and version on each document', async () => {
      const project = await createProject('Service template version stored')

      await uploadCombined(project.id, BOTH_STAGES)

      const { baseline, postIntervention } = await fetchProject(project.id)
      expect(baseline.template).toEqual(TEMPLATE_1_0)
      expect(postIntervention.template).toEqual(TEMPLATE_1_0)
    })

    it('stores the same baseline the baseline endpoint does', async () => {
      const combined = await createProject('Service template combined')
      const baselineOnly = await createProject('Service template baseline')

      await uploadCombined(combined.id, BOTH_STAGES)
      await callValidate(await uploadFixture(BOTH_STAGES), {
        projectId: baselineOnly.id
      })

      const fromCombined = (await fetchProject(combined.id)).baseline
      const fromBaseline = (await fetchProject(baselineOnly.id)).baseline
      for (const [layer] of LAYERS) {
        expect(
          fromCombined[layer].map(({ featureId, ...feature }) => feature)
        ).toEqual(
          fromBaseline[layer].map(({ featureId, ...feature }) => feature)
        )
      }
      expect(fromCombined.units).toEqual(fromBaseline.units)
    })

    it('replaces a baseline already stored for the project', async () => {
      const project = await createProject('Service template replaced')
      await callValidate(await uploadFixture(BASELINE_STAGE), {
        projectId: project.id
      })

      const res = await uploadCombined(project.id, BOTH_STAGES)

      expect(res.result).toEqual({ valid: true, errors: [] })
      const { baseline } = await fetchProject(project.id)
      expect(storedRefs(baseline, 'habitats')).toEqual(
        refsOf(fixturePath(BOTH_STAGES), 'Area Habitats Baseline')
      )
    })

    it('keeps each feature’s identity when the file is uploaded again', async () => {
      const project = await createProject('Service template combined again')
      await uploadCombined(project.id, BOTH_STAGES)
      const first = await fetchProject(project.id)

      await uploadCombined(project.id, BOTH_STAGES)
      const second = await fetchProject(project.id)

      for (const document of ['baseline', 'postIntervention']) {
        expect(
          second[document].habitats.map(({ featureId }) => featureId)
        ).toEqual(first[document].habitats.map(({ featureId }) => featureId))
      }
    })

    /** The first area habitat's units, with one strategic significance set. */
    async function unitsWithSignificance(stage, value) {
      const [table, column, document] =
        stage === 'baseline'
          ? [
              'Area Habitats Baseline',
              'Baseline Strategic Significance',
              'baseline'
            ]
          : [
              'Area Habitats Post-Intervention',
              'Proposed Strategic Significance',
              'postIntervention'
            ]
      const project = await createProject(`Strategic significance ${value}`)
      const filePath = withValue(BOTH_STAGES, { table, fid: 1, column, value })
      const res = await uploadCombined(project.id, BOTH_STAGES, filePath)
      expect(res.result).toEqual({ valid: true, errors: [] })
      const stored = await fetchProject(project.id)
      return stored[document].habitats[0].units
    }

    // The template records strategic significance as Low or High. Post-
    // intervention, the engine prices each with the metric's multiplier.
    it('prices a post-intervention habitat’s Low and High strategic significance with the metric’s multipliers', async () => {
      const low = await unitsWithSignificance('post-intervention', 'Low')
      const high = await unitsWithSignificance('post-intervention', 'High')

      expect(low).toBeGreaterThan(0)
      expect(high / low).toBeCloseTo(HIGH_MULTIPLIER, UNITS_PRECISION)
    })

    // The service follows the metric's rules for an area whose Local Nature
    // Recovery Strategy is published, as it assumes every area's is: baseline
    // strategic significance is always Low (User Guide, chapter 4).
    it('prices a baseline habitat at Low strategic significance, whatever the file records', async () => {
      const low = await unitsWithSignificance('baseline', 'Low')
      const high = await unitsWithSignificance('baseline', 'High')

      expect(low).toBeGreaterThan(0)
      expect(high).toBe(low)
    })

    it('refuses a file whose Post-Intervention tables are all empty, and changes nothing', async () => {
      const project = await createProject('Service template PI empty')
      await callValidate(await uploadFixture(BOTH_STAGES), {
        projectId: project.id
      })
      const before = await fetchProject(project.id)

      const res = await uploadCombined(project.id, BASELINE_STAGE)

      expect(res.statusCode).toBe(HTTP_OK)
      expect(res.result).toEqual({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.POST_INTERVENTION_TABLES_EMPTY,
            details: { template: TEMPLATE_1_0 }
          })
        ]
      })
      expect(await fetchProject(project.id)).toEqual(before)
    })

    it.each([
      ['Area Habitats Baseline', 'baseline'],
      ['Area Habitats Post-Intervention', 'post-intervention']
    ])(
      'refuses a blank Habitat Ref in %s, naming the table, row and stage, and stores nothing',
      async (table, stage) => {
        const project = await createProject('Service template blank ref')
        const filePath = withValue(BOTH_STAGES, {
          table,
          fid: 2,
          column: 'Habitat Ref',
          value: ''
        })

        const res = await uploadCombined(project.id, BOTH_STAGES, filePath)

        expect(res.statusCode).toBe(HTTP_OK)
        expect(res.result.valid).toBe(false)
        expect(res.result.errors).toContainEqual(
          expect.objectContaining({
            code: ERROR_CODES.HABITAT_REF_MISSING,
            message: expect.stringContaining(`${table} fid 2`),
            stage
          })
        )
        const stored = await fetchProject(project.id)
        expect(stored.baseline).toBeUndefined()
        expect(stored.postIntervention).toBeUndefined()
      }
    )

    it('reports the errors in both stages at once', async () => {
      const project = await createProject('Service template both stages')
      const baselineBlank = withValue(BOTH_STAGES, {
        table: 'Area Habitats Baseline',
        fid: 2,
        column: 'Habitat Ref',
        value: ''
      })
      const db = new Database(baselineBlank)
      try {
        db.prepare(
          `UPDATE "Area Habitats Post-Intervention" SET "Habitat Ref" = '' WHERE fid = 3`
        ).run()
      } finally {
        db.close()
      }

      const res = await uploadCombined(project.id, BOTH_STAGES, baselineBlank)

      expect(res.result.valid).toBe(false)
      expect(res.result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: ERROR_CODES.HABITAT_REF_MISSING,
            message: expect.stringContaining('Area Habitats Baseline fid 2'),
            stage: 'baseline'
          }),
          expect.objectContaining({
            code: ERROR_CODES.HABITAT_REF_MISSING,
            message: expect.stringContaining(
              'Area Habitats Post-Intervention fid 3'
            ),
            stage: 'post-intervention'
          })
        ])
      )
      const stored = await fetchProject(project.id)
      expect(stored.baseline).toBeUndefined()
    })

    // Every Post-Intervention table counts towards the empty check, including
    // those not read yet (trees, BMD-1172; vertical area habitats, BMD-1084),
    // as the ticket defines it. A file whose only post-intervention rows are
    // trees passes that check, and must still be refused, with nothing stored.
    it('refuses a file whose only post-intervention features are in tables not read yet, and changes nothing', async () => {
      const project = await createProject('Service template trees only')
      await uploadCombined(project.id, BOTH_STAGES)
      const before = await fetchProject(project.id)
      const copy = copyOf(BOTH_STAGES)
      const db = new Database(copy)
      try {
        for (const table of [
          'Area Habitats Post-Intervention',
          'Hedgerows Post-Intervention',
          'Watercourses Post-Intervention'
        ]) {
          db.prepare(`DELETE FROM "${table}"`).run()
        }
        expect(
          db
            .prepare(
              'SELECT count(*) AS n FROM "Individual Trees Post-Intervention"'
            )
            .get().n
        ).toBeGreaterThan(0)
      } finally {
        db.close()
      }

      const res = await uploadCombined(project.id, BOTH_STAGES, copy)

      expect(res.result).toEqual({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.NO_HABITAT_AREAS,
            stage: 'post-intervention'
          })
        ]
      })
      expect(await fetchProject(project.id)).toEqual(before)
    })
  }
)
