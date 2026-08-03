// End-to-end guarantee for the PowerBI / Synapse integration: a feature's
// `featureId` is the primary key of its row downstream, so it must survive both
// an edit and a re-upload of the same GeoPackage. Before the carry-forward,
// every upload re-keyed every feature — a ~1000-parcel site looked like 1000
// deletes and 1000 inserts on their side.
import { describe, expect, it } from 'vitest'

import { HTTP_OK } from './helpers/http-status.js'
import {
  FIXTURE,
  callValidate,
  createProject,
  fetchLayerRows,
  fetchProject,
  getPersistenceTestContext,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

const FEATURE_LAYERS = ['habitats', 'trees', 'hedgerows', 'watercourses']

registerPersistenceTestHooks()

/**
 * ref → featureId for one layer, skipping features with no ref (they are
 * expected to re-key and are not part of the guarantee).
 */
function idsByRef(features) {
  const map = new Map()
  for (const feature of features ?? []) {
    if (feature.ref) {
      map.set(feature.ref, feature.featureId)
    }
  }
  return map
}

function allIdsByRef(document) {
  return Object.fromEntries(
    FEATURE_LAYERS.map((layer) => [layer, idsByRef(document[layer])])
  )
}

async function importBaseline(projectId) {
  const uploadId = await uploadFixture(FIXTURE)
  const res = await callValidate(uploadId, { projectId })
  expect(res.statusCode).toBe(HTTP_OK)
  expect(res.result).toEqual({ valid: true, errors: [] })
  return fetchProject(projectId)
}

describe('featureId stability across edits and re-uploads', () => {
  it('exposes projectId alongside id on the project envelope', async () => {
    const project = await createProject('Integration test — projectId')

    expect(project.projectId).toBe(project.id)
  })

  it('keeps every featureId when the same GeoPackage is re-uploaded', async () => {
    const project = await createProject('Integration test — re-upload')

    const first = await importBaseline(project.id)
    const before = allIdsByRef(first.baseline)
    // Guard the guard: a fixture with no refs would make this vacuous.
    expect(before.habitats.size).toBeGreaterThan(0)
    expect(before.hedgerows.size).toBeGreaterThan(0)

    const second = await importBaseline(project.id)
    const after = allIdsByRef(second.baseline)

    for (const layer of FEATURE_LAYERS) {
      expect(
        Object.fromEntries(after[layer]),
        `${layer} featureIds changed across re-upload`
      ).toEqual(Object.fromEntries(before[layer]))
    }
  })

  it('keeps the red line featureId across a re-upload', async () => {
    const project = await createProject('Integration test — red line')

    const first = await importBaseline(project.id)
    expect(first.baseline.redLine).not.toBeNull()

    const second = await importBaseline(project.id)

    expect(second.baseline.redLine.featureId).toBe(
      first.baseline.redLine.featureId
    )
  })

  it('re-points the geometry rows at the carried-forward ids', async () => {
    const project = await createProject('Integration test — geometry join')

    await importBaseline(project.id)
    const second = await importBaseline(project.id)

    const geometryIds = (await fetchLayerRows('baseline_habitats', project.id))
      .map((row) => row.id)
      .sort()
    const documentIds = second.baseline.habitats
      .map((habitat) => habitat.featureId)
      .sort()

    expect(geometryIds).toEqual(documentIds)
  })

  it('keeps the featureId when a feature is edited, then re-uploaded', async () => {
    const { server, headers } = getPersistenceTestContext()
    const project = await createProject('Integration test — edit then reupload')

    const first = await importBaseline(project.id)
    const target = first.baseline.habitats.find(
      (habitat) => habitat.ref && habitat.broadType === 'Grassland'
    )
    expect(target, 'fixture has no grassland habitat to edit').toBeDefined()

    const edit = await server.inject({
      headers,
      method: 'PUT',
      url: `/projects/${project.id}/features/${target.featureId}`,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })
    expect(edit.statusCode).toBe(HTTP_OK)
    expect(edit.result.feature.featureId).toBe(target.featureId)

    const afterEdit = await fetchProject(project.id)
    expect(idsByRef(afterEdit.baseline.habitats).get(target.ref)).toBe(
      target.featureId
    )

    const afterReupload = await importBaseline(project.id)
    expect(idsByRef(afterReupload.baseline.habitats).get(target.ref)).toBe(
      target.featureId
    )
  })

  // The mixed case: one stored ref no longer matches anything incoming, so that
  // feature re-keys while every other ref keeps its id. Mutating the stored ref
  // is the cheapest way to model "a parcel was renamed in QGIS" without a
  // second fixture.
  it('re-keys only the features whose ref no longer matches', async () => {
    const { dbClient } = getPersistenceTestContext()
    const project = await createProject('Integration test — partial match')

    const first = await importBaseline(project.id)
    const before = idsByRef(first.baseline.habitats)
    const renamed = first.baseline.habitats.find((habitat) => habitat.ref)

    await dbClient.query(
      `UPDATE bng.projects
          SET project = jsonb_set(project, $2::text[], '"RENAMED-REF"'::jsonb)
        WHERE id = $1`,
      [
        project.id,
        `{baseline,habitats,${first.baseline.habitats.indexOf(renamed)},ref}`
      ]
    )

    const second = await importBaseline(project.id)
    const after = idsByRef(second.baseline.habitats)

    // The renamed parcel lost its anchor, so it gets a fresh id...
    expect(after.get(renamed.ref)).not.toBe(before.get(renamed.ref))
    // ...and every other parcel is untouched.
    for (const [ref, featureId] of before) {
      if (ref !== renamed.ref) {
        expect(after.get(ref), `ref ${ref} should have kept its id`).toBe(
          featureId
        )
      }
    }
  })
})
