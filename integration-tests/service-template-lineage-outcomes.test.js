import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { describeServiceTemplate } from '../test/helpers/template-mode.js'
import { fixturePath } from './helpers/upload-fixtures.js'
import {
  callPostInterventionValidate,
  createProject,
  fetchProject,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

const EVERY_COLUMN = 'service-template/default-site.gpkg'
// The harness's incomplete/ files: the default site, with a watercourse that
// gets worse recorded so the service saves it Incomplete.
const ADVANCE_NOT_ENCROACHMENT =
  'service-template/degrade-watercourse-advance-not-encroachment.gpkg'
const ENCROACHMENT_NO_ADVANCE =
  'service-template/degrade-watercourse-encroachment-no-advance.gpkg'
const AREA_PI = 'Area Habitats Post-Intervention'
const INCOMPLETE = 'Incomplete'
const COMPLETE = 'Complete'

let scratch
beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'service-template-outcomes-'))
})
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

async function uploadCombined(projectId, fixture, filePath) {
  return callPostInterventionValidate(await uploadFixture(fixture, filePath), {
    projectId
  })
}

const byRef = (features, ref) => features.find((f) => f.ref === ref)

describeServiceTemplate(
  'What a BNG Service template upload does to its baseline habitats — with the service-template flag on',
  () => {
    it('records each baseline habitat it loses, and how', async () => {
      const project = await createProject('Lineage outcomes')

      const res = await uploadCombined(project.id, EVERY_COLUMN)

      expect(res.result).toEqual({ valid: true, errors: [] })
      const { baseline, postIntervention } = await fetchProject(project.id)
      const lost = postIntervention.lostHabitats
      // R002, a ditch, has no post-intervention habitat.
      const ditch = byRef(baseline.watercourses, 'R002')
      expect(lost).toContainEqual({
        layer: 'watercourses',
        featureId: ditch.featureId,
        ref: 'R002',
        type: 'Ditches',
        outcome: 'removed',
        lostSizeMetres: ditch.sizeMetres,
        recreatedAs: []
      })
      // Every habitat that gets worse is its parent lost and re-created.
      const recreated = lost.filter((e) => e.outcome === 'lostAndRecreated')
      expect(recreated.length).toBeGreaterThan(0)
      for (const entry of recreated) {
        expect(entry.recreatedAs.length, entry.ref).toBeGreaterThan(0)
        for (const featureId of entry.recreatedAs) {
          const child = postIntervention[entry.layer].find(
            (f) => f.featureId === featureId
          )
          expect(child.parentFeatureId).toBe(entry.featureId)
          expect(child.retentionCategory).toBe('Created')
        }
      }
      expect(
        lost.some((e) => e.outcome === 'removed' && e.layer === 'habitats')
      ).toBe(false)
    })

    it('saves a watercourse that gets worse other than by encroachment, 10 years in advance, Incomplete with no advance', async () => {
      const project = await createProject('Lineage watercourse advance')

      const res = await uploadCombined(project.id, ADVANCE_NOT_ENCROACHMENT)

      expect(res.result).toEqual({ valid: true, errors: [] })
      const { watercourses } = (await fetchProject(project.id)).postIntervention
      const worse = byRef(watercourses, 'R005')
      expect(worse.status).toBe(INCOMPLETE)
      expect(worse.units).toBeNull()
      expect(worse.proposed.advanceYears).toBeNull()
      // An encroachment-only change may be created 10 years in advance.
      const encroached = byRef(watercourses, 'R004')
      expect(encroached.status).toBe(COMPLETE)
      expect(encroached.proposed.advanceYears).toBe(10)
    })

    it('saves an encroachment-only change with no years in advance Incomplete', async () => {
      const project = await createProject('Lineage encroachment no advance')

      const res = await uploadCombined(project.id, ENCROACHMENT_NO_ADVANCE)

      expect(res.result).toEqual({ valid: true, errors: [] })
      const { watercourses } = (await fetchProject(project.id)).postIntervention
      const encroached = byRef(watercourses, 'R004')
      expect(encroached.status).toBe(INCOMPLETE)
      expect(encroached.proposed.advanceYears).toBeNull()
    })

    it('saves a habitat whose years in advance are text, from an older template copy, Incomplete with no advance', async () => {
      const project = await createProject('Lineage text advance')
      const filePath = path.join(scratch, 'text-advance.gpkg')
      copyFileSync(fixturePath(EVERY_COLUMN), filePath)
      const db = new Database(filePath)
      let ref
      try {
        const row = db
          .prepare(
            `SELECT fid, "Habitat Ref" AS ref FROM "${AREA_PI}" WHERE "Retention Category" = 'Created' ORDER BY fid LIMIT 1`
          )
          .get()
        ref = row.ref
        db.prepare(
          `UPDATE "${AREA_PI}" SET "Habitat created in advance/years" = 'Habitat already in target condition', "Delay in starting habitat creation/years" = 'N/A' WHERE fid = ?`
        ).run(row.fid)
      } finally {
        db.close()
      }

      const res = await uploadCombined(project.id, EVERY_COLUMN, filePath)

      expect(res.result).toEqual({ valid: true, errors: [] })
      const { habitats } = (await fetchProject(project.id)).postIntervention
      const created = habitats.find(
        (f) => f.ref === ref && f.retentionCategory === 'Created'
      )
      expect(created.status).toBe(INCOMPLETE)
      expect(created.proposed.advanceYears).toBeNull()
      expect(created.proposed.delayYears).toBeNull()
    })
  }
)
